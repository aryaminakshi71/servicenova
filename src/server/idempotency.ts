import type { Context } from 'hono';
import { nowMs } from './test-controls';

export type IdempotencyCacheRecord = {
	status: number;
	body: unknown;
	createdAt: number;
};

export interface IdempotencyStore {
	get(
		scope: string,
	): IdempotencyCacheRecord | Promise<IdempotencyCacheRecord | null> | null;
	set(scope: string, entry: IdempotencyCacheRecord): void | Promise<void>;
	cleanup?(ttlMs: number): void | Promise<void>;
}

class InMemoryIdempotencyStore implements IdempotencyStore {
	private readonly cache = new Map<string, IdempotencyCacheRecord>();

	get(scope: string) {
		return this.cache.get(scope) ?? null;
	}

	set(scope: string, entry: IdempotencyCacheRecord) {
		this.cache.set(scope, entry);
	}

	cleanup(ttlMs: number) {
		const threshold = nowMs() - ttlMs;

		for (const [key, value] of this.cache) {
			if (value.createdAt < threshold) {
				this.cache.delete(key);
			}
		}
	}
}

const TTL_MS = 1000 * 60 * 30;
let store: IdempotencyStore = new InMemoryIdempotencyStore();

function stableHash(input: string) {
	const bytes = new TextEncoder().encode(input);
	let hash = 0;

	for (const byte of bytes) {
		hash = (hash * 31 + byte) >>> 0;
	}

	return hash.toString(16);
}

function runCleanup() {
	if (store.cleanup) {
		void Promise.resolve(store.cleanup(TTL_MS)).catch(() => {});
	}
}

export function configureIdempotencyStore(nextStore: IdempotencyStore) {
	store = nextStore;
}

export function idempotencyKey(
	c: Context,
	operation: string,
	payload: unknown,
) {
	const key = c.req.header('idempotency-key');

	if (!key) {
		return null;
	}

	const auth = c.get('auth') as
		| { userId?: string; tenantId?: string }
		| undefined;
	const userId = auth?.userId ?? 'anonymous';
	const tenantId = auth?.tenantId ?? c.req.header('x-tenant-id') ?? 'default';
	const scope = `${tenantId}:${operation}:${userId}:${stableHash(JSON.stringify(payload))}:${key}`;

	return scope;
}

export async function replayIdempotent(c: Context, scope: string) {
	runCleanup();

	const cached = await Promise.resolve(store.get(scope));

	if (!cached) {
		return null;
	}

	if (cached.createdAt < nowMs() - TTL_MS) {
		return null;
	}

	c.header('x-idempotent-replay', 'true');
	return c.json(cached.body as never, cached.status as never);
}

export async function storeIdempotent(
	scope: string,
	status: number,
	body: unknown,
) {
	runCleanup();

	await Promise.resolve(
		store.set(scope, {
			status,
			body,
			createdAt: nowMs(),
		}),
	);
}
