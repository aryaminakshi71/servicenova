import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	configureRateLimitStore,
	enforceRateLimit,
	resetRateLimiterForTests,
} from '../rate-limit';
import { configureFieldOpsPersistenceFromEnv } from './persistence';

const originalEnv = { ...process.env };

function restoreEnv() {
	for (const key of Object.keys(process.env)) {
		if (!(key in originalEnv)) {
			delete process.env[key];
		}
	}

	for (const [key, value] of Object.entries(originalEnv)) {
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
}

function createLimitedApp() {
	const app = new Hono();

	app.use('*', async (c, next) => {
		(c as unknown as { set: (key: string, value: unknown) => void }).set(
			'auth',
			{
				role: 'manager',
				userId: 'persistence-test',
			},
		);
		const blocked = await enforceRateLimit(c, 'mutation');

		if (blocked) {
			return blocked;
		}

		await next();
	});

	app.post('/api/field/jobs/assign', (c) => c.json({ ok: true }));
	return app;
}

describe('persistence bootstrap fallback', () => {
	beforeEach(() => {
		restoreEnv();
		resetRateLimiterForTests();
		process.env.RATE_LIMIT_ENABLED = 'true';
		process.env.RATE_LIMIT_WINDOW_MS = '60000';
		process.env.RATE_LIMIT_MUTATION_LIMIT = '1';
	});

	afterEach(() => {
		resetRateLimiterForTests();
		restoreEnv();
	});

	it('switches rate-limit store back to in-memory when persistence mode is memory', async () => {
		configureRateLimitStore({
			increment() {
				return {
					count: 999,
					resetAt: Date.now() + 60_000,
				};
			},
		});

		process.env.FIELD_OPS_PERSISTENCE = 'memory';

		await configureFieldOpsPersistenceFromEnv({
			info() {},
			warn() {},
		});

		const app = createLimitedApp();
		const first = await app.request('/api/field/jobs/assign', {
			method: 'POST',
		});
		const second = await app.request('/api/field/jobs/assign', {
			method: 'POST',
		});

		expect(first.status).toBe(200);
		expect(second.status).toBe(429);
	});

	it('falls back to in-memory rate-limit store when postgres mode has no DATABASE_URL', async () => {
		configureRateLimitStore({
			increment() {
				return {
					count: 999,
					resetAt: Date.now() + 60_000,
				};
			},
		});

		process.env.FIELD_OPS_PERSISTENCE = 'postgres';
		delete process.env.DATABASE_URL;

		const result = await configureFieldOpsPersistenceFromEnv({
			info() {},
			warn() {},
		});

		expect(result.enabled).toBe(false);
		expect(result.mode).toBe('memory');

		const app = createLimitedApp();
		const first = await app.request('/api/field/jobs/assign', {
			method: 'POST',
		});
		expect(first.status).toBe(200);
	});

	it('falls back to in-memory rate-limit store when postgres adapter init fails', async () => {
		configureRateLimitStore({
			increment() {
				return {
					count: 999,
					resetAt: Date.now() + 60_000,
				};
			},
		});

		process.env.FIELD_OPS_PERSISTENCE = 'postgres';
		process.env.DATABASE_URL =
			'postgres://postgres:postgres@127.0.0.1:1/servicenova-ai';

		const result = await configureFieldOpsPersistenceFromEnv({
			info() {},
			warn() {},
		});

		expect(result.enabled).toBe(false);
		expect(result.mode).toBe('memory');

		const app = createLimitedApp();
		const first = await app.request('/api/field/jobs/assign', {
			method: 'POST',
		});
		expect(first.status).toBe(200);
	});
});
