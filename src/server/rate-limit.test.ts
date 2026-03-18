import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	configureRateLimitStore,
	enforceRateLimit,
	resetRateLimiterForTests,
} from './rate-limit';

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

function createMutationApp() {
	const app = new Hono();

	app.use('*', async (c, next) => {
		(c as unknown as { set: (key: string, value: unknown) => void }).set(
			'auth',
			{
				role: 'manager',
				userId: 'rate-limit-test',
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

describe('rate-limit store behavior', () => {
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

	it('enforces limits when using a custom store', async () => {
		let count = 0;
		configureRateLimitStore({
			increment() {
				count += 1;
				return {
					count,
					resetAt: Date.now() + 60_000,
				};
			},
		});

		const app = createMutationApp();
		const first = await app.request('/api/field/jobs/assign', {
			method: 'POST',
		});
		const second = await app.request('/api/field/jobs/assign', {
			method: 'POST',
		});

		expect(first.status).toBe(200);
		expect(second.status).toBe(429);
	});

	it('fails open when custom store throws', async () => {
		configureRateLimitStore({
			increment() {
				throw new Error('store unavailable');
			},
		});

		const app = createMutationApp();
		const response = await app.request('/api/field/jobs/assign', {
			method: 'POST',
		});

		expect(response.status).toBe(200);
	});
});
