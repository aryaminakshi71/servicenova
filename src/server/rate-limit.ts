import type { Context } from 'hono';
import { nowMs } from './test-controls';

type RateLimitBucket = 'mutation' | 'integration';

type RateLimitCounter = {
	count: number;
	resetAt: number;
};

type RateLimitConfig = {
	enabled: boolean;
	windowMs: number;
	mutationLimit: number;
	integrationLimit: number;
	adminMutationLimit: number;
	adminIntegrationLimit: number;
	bypassRoles: Set<string>;
	bypassSubjects: Set<string>;
};

export interface RateLimitStore {
	increment(
		scopeKey: string,
		windowMs: number,
		nowMs: number,
	): RateLimitCounter | Promise<RateLimitCounter>;
	cleanup?(beforeMs: number): void | Promise<void>;
}

class InMemoryRateLimitStore implements RateLimitStore {
	private readonly counters = new Map<string, RateLimitCounter>();

	increment(
		scopeKey: string,
		windowMs: number,
		nowMs: number,
	): RateLimitCounter {
		const current = this.counters.get(scopeKey);

		if (!current || current.resetAt <= nowMs) {
			const created: RateLimitCounter = {
				count: 1,
				resetAt: nowMs + windowMs,
			};
			this.counters.set(scopeKey, created);
			return created;
		}

		const next = {
			...current,
			count: current.count + 1,
		};

		this.counters.set(scopeKey, next);
		return next;
	}

	cleanup(beforeMs: number) {
		for (const [key, value] of this.counters) {
			if (value.resetAt <= beforeMs) {
				this.counters.delete(key);
			}
		}
	}
}

const CLEANUP_INTERVAL_MS = 60_000;

let store: RateLimitStore = new InMemoryRateLimitStore();
let lastCleanupAt = 0;

function parseBooleanEnv(name: string, fallback: boolean) {
	const raw = process.env[name];

	if (raw === undefined) {
		return fallback;
	}

	const normalized = raw.trim().toLowerCase();
	return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function parseIntEnv(name: string, fallback: number, min: number, max: number) {
	const raw = process.env[name];

	if (raw === undefined) {
		return fallback;
	}

	const parsed = Number.parseInt(raw, 10);

	if (Number.isNaN(parsed)) {
		return fallback;
	}

	return Math.min(max, Math.max(min, parsed));
}

function parseCsvEnv(name: string) {
	const raw = process.env[name];

	if (!raw) {
		return new Set<string>();
	}

	return new Set(
		raw
			.split(',')
			.map((item) => item.trim())
			.filter(Boolean),
	);
}

function getConfig(): RateLimitConfig {
	const isTestRuntime =
		process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
	const enabled = parseBooleanEnv('RATE_LIMIT_ENABLED', !isTestRuntime);

	return {
		enabled,
		windowMs: parseIntEnv('RATE_LIMIT_WINDOW_MS', 60_000, 1_000, 3_600_000),
		mutationLimit: parseIntEnv('RATE_LIMIT_MUTATION_LIMIT', 120, 1, 50_000),
		integrationLimit: parseIntEnv(
			'RATE_LIMIT_INTEGRATION_LIMIT',
			60,
			1,
			50_000,
		),
		adminMutationLimit: parseIntEnv(
			'RATE_LIMIT_ADMIN_MUTATION_LIMIT',
			300,
			1,
			50_000,
		),
		adminIntegrationLimit: parseIntEnv(
			'RATE_LIMIT_ADMIN_INTEGRATION_LIMIT',
			180,
			1,
			50_000,
		),
		bypassRoles: parseCsvEnv('RATE_LIMIT_BYPASS_ROLES'),
		bypassSubjects: parseCsvEnv('RATE_LIMIT_BYPASS_SUBJECTS'),
	};
}

function subjectKey(c: Context) {
	const auth = c.get('auth') as
		| { role?: string; userId?: string; tenantId?: string }
		| undefined;
	const tenant = auth?.tenantId ?? c.req.header('x-tenant-id') ?? 'default';

	if (auth?.userId && auth?.role) {
		return `${tenant}:${auth.role}:${auth.userId}`;
	}

	const identifier =
		c.req.header('cf-connecting-ip') ??
		c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
		'anonymous';

	return `${tenant}:${identifier}`;
}

function subjectRole(c: Context) {
	const auth = c.get('auth') as { role?: string } | undefined;
	return auth?.role ?? 'anonymous';
}

function legacySubjectKey(c: Context) {
	const auth = c.get('auth') as { role?: string; userId?: string } | undefined;

	if (auth?.userId && auth?.role) {
		return `${auth.role}:${auth.userId}`;
	}

	return (
		c.req.header('cf-connecting-ip') ??
		c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
		'anonymous'
	);
}

function counterKey(c: Context, bucket: RateLimitBucket) {
	return `${bucket}:${subjectKey(c)}:${c.req.path}`;
}

function maybeCleanup(nowMs: number) {
	if (!store.cleanup) {
		return;
	}

	if (nowMs - lastCleanupAt < CLEANUP_INTERVAL_MS) {
		return;
	}

	lastCleanupAt = nowMs;
	void Promise.resolve(store.cleanup(nowMs)).catch(() => {});
}

export function configureRateLimitStore(nextStore: RateLimitStore) {
	store = nextStore;
	lastCleanupAt = 0;
}

export function resetInMemoryRateLimitStore() {
	store = new InMemoryRateLimitStore();
	lastCleanupAt = 0;
}

export function resetRateLimiterForTests() {
	resetInMemoryRateLimitStore();
}

export async function enforceRateLimit(c: Context, bucket: RateLimitBucket) {
	const config = getConfig();

	if (!config.enabled) {
		return null;
	}

	const role = subjectRole(c);
	const subject = subjectKey(c);
	const legacySubject = legacySubjectKey(c);

	if (
		config.bypassRoles.has(role) ||
		config.bypassSubjects.has(subject) ||
		config.bypassSubjects.has(legacySubject)
	) {
		c.header('x-ratelimit-bypass', 'true');
		return null;
	}

	const limit =
		role === 'admin'
			? bucket === 'integration'
				? config.adminIntegrationLimit
				: config.adminMutationLimit
			: bucket === 'integration'
				? config.integrationLimit
				: config.mutationLimit;
	const currentMs = nowMs();
	maybeCleanup(currentMs);

	let counter: RateLimitCounter;

	try {
		counter = await Promise.resolve(
			store.increment(counterKey(c, bucket), config.windowMs, currentMs),
		);
	} catch (error) {
		if (process.env.NODE_ENV !== 'test' && process.env.VITEST !== 'true') {
			console.warn(`[rate-limit] failed open: ${String(error)}`);
		}
		return null;
	}

	const remaining = Math.max(0, limit - counter.count);

	c.header('x-ratelimit-limit', String(limit));
	c.header('x-ratelimit-remaining', String(remaining));
	c.header('x-ratelimit-reset', String(Math.ceil(counter.resetAt / 1000)));

	if (counter.count <= limit) {
		return null;
	}

	const retryAfterSeconds = Math.max(
		1,
		Math.ceil((counter.resetAt - currentMs) / 1000),
	);
	c.header('retry-after', String(retryAfterSeconds));

	return c.json(
		{
			error: 'Too many requests',
			bucket,
			retryAfterSeconds,
		},
		429,
	);
}
