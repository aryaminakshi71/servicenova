import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app';

function jwtToken(input: {
	role: string;
	sub: string;
	tenantId: string;
	expSecondsFromNow?: number;
}) {
	const header = Buffer.from(
		JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
	).toString('base64url');
	const payload = Buffer.from(
		JSON.stringify({
			role: input.role,
			sub: input.sub,
			tenantId: input.tenantId,
			exp: Math.floor(Date.now() / 1000) + (input.expSecondsFromNow ?? 3600),
		}),
	).toString('base64url');
	const secret = process.env.AUTH_JWT_SECRET ?? 'test-secret';
	const signature = createHmac('sha256', secret)
		.update(`${header}.${payload}`)
		.digest('base64url');
	return `${header}.${payload}.${signature}`;
}

describe('auth and RBAC', () => {
	it('rejects unauthenticated field request', async () => {
		const app = createApp();
		const response = await app.request('/api/field/dispatch-board');

		expect(response.status).toBe(401);
	});

	it('forbids insufficient role for manager-only endpoint', async () => {
		const app = createApp();
		const response = await app.request('/api/field/analytics/kpis', {
			headers: {
				authorization: 'Bearer technician:t-1',
			},
		});

		expect(response.status).toBe(403);
	});

	it('allows manager role for analytics endpoint', async () => {
		const app = createApp();
		const response = await app.request('/api/field/analytics/kpis', {
			headers: {
				authorization: 'Bearer manager:m-1',
			},
		});

		expect(response.status).toBe(200);
	});

	it('forbids technician role from assignment endpoint', async () => {
		const app = createApp();
		const response = await app.request('/api/field/jobs/assign', {
			method: 'POST',
			headers: {
				authorization: 'Bearer technician:t-1',
			},
			body: JSON.stringify({ jobId: 'job-100' }),
		});

		expect(response.status).toBe(403);
	});

	it('allows technician role on start endpoint (state may still conflict)', async () => {
		const app = createApp();
		const response = await app.request('/api/field/jobs/job-100/start', {
			method: 'POST',
			headers: {
				authorization: 'Bearer technician:t-1',
			},
			body: JSON.stringify({}),
		});

		expect(response.status).toBe(409);
	});

	it('allows technician role on work-order intelligence endpoint', async () => {
		const app = createApp();
		const response = await app.request('/api/field/jobs/job-100/intelligence', {
			method: 'POST',
			headers: {
				authorization: 'Bearer technician:t-1',
			},
			body: JSON.stringify({
				symptoms: ['compressor fault'],
			}),
		});

		expect(response.status).toBe(200);
	});

	it('allows technician role on technician assist briefing endpoint', async () => {
		const app = createApp();
		const response = await app.request(
			'/api/field/jobs/job-100/assist/briefing',
			{
				method: 'POST',
				headers: {
					authorization: 'Bearer technician:t-1',
				},
				body: JSON.stringify({}),
			},
		);

		expect(response.status).toBe(200);
	});

	it('forbids technician role on intelligence accuracy endpoint', async () => {
		const app = createApp();
		const response = await app.request('/api/field/intelligence/accuracy', {
			headers: {
				authorization: 'Bearer technician:t-1',
			},
		});

		expect(response.status).toBe(403);
	});

	it('forbids technician role on intelligence quality report endpoint', async () => {
		const app = createApp();
		const response = await app.request(
			'/api/field/intelligence/quality-report',
			{
				headers: {
					authorization: 'Bearer technician:t-1',
				},
			},
		);

		expect(response.status).toBe(403);
	});

	it('forbids technician role on intelligence drift alerts endpoint', async () => {
		const app = createApp();
		const response = await app.request('/api/field/intelligence/drift-alerts', {
			headers: {
				authorization: 'Bearer technician:t-1',
			},
		});

		expect(response.status).toBe(403);
	});

	it('forbids technician role on intelligence confirmation endpoint', async () => {
		const app = createApp();
		const response = await app.request(
			'/api/field/jobs/job-100/intelligence/confirm',
			{
				method: 'POST',
				headers: {
					authorization: 'Bearer technician:t-1',
				},
				body: JSON.stringify({
					runId: 'run-1',
					action: 'auto_dispatch',
				}),
			},
		);

		expect(response.status).toBe(403);
	});

	it('forbids technician role on disruption handling endpoint', async () => {
		const app = createApp();
		const response = await app.request('/api/field/dispatch/disruptions', {
			method: 'POST',
			headers: {
				authorization: 'Bearer technician:t-1',
			},
			body: JSON.stringify({
				type: 'traffic_incident',
				reason: 'Road closure',
				affectedJobIds: ['job-100'],
			}),
		});

		expect(response.status).toBe(403);
	});

	it('forbids technician role on dispatch optimizer endpoint', async () => {
		const app = createApp();
		const response = await app.request('/api/field/dispatch/optimize', {
			method: 'POST',
			headers: {
				authorization: 'Bearer technician:t-1',
			},
			body: JSON.stringify({}),
		});

		expect(response.status).toBe(403);
	});

	it('allows technician role on mobile sync endpoint', async () => {
		const app = createApp();
		const response = await app.request('/api/field/mobile/sync', {
			method: 'POST',
			headers: {
				authorization: 'Bearer technician:t-1',
			},
			body: JSON.stringify({
				operations: [
					{
						clientOperationId: 'mob-1',
						type: 'start_job',
						payload: { jobId: 'job-100' },
					},
				],
			}),
		});

		expect(response.status).toBe(200);
	});

	it('forbids technician role on observability metrics endpoint', async () => {
		const app = createApp();
		const response = await app.request('/api/field/observability/metrics', {
			headers: {
				authorization: 'Bearer technician:t-1',
			},
		});

		expect(response.status).toBe(403);
	});

	it('forbids dispatcher role on automation cycle endpoint', async () => {
		const app = createApp();
		const response = await app.request('/api/field/ops/automation/run-cycle', {
			method: 'POST',
			headers: {
				authorization: 'Bearer dispatcher:d-1',
			},
			body: JSON.stringify({}),
		});

		expect(response.status).toBe(403);
	});

	it('rejects query fallback auth when explicitly disabled', async () => {
		const previous = process.env.AUTH_ALLOW_QUERY_FALLBACK;
		process.env.AUTH_ALLOW_QUERY_FALLBACK = 'false';

		try {
			const app = createApp();
			const response = await app.request(
				'/api/field/dispatch-board?role=manager&userId=stream-client',
			);

			expect(response.status).toBe(401);
		} finally {
			if (previous === undefined) {
				delete process.env.AUTH_ALLOW_QUERY_FALLBACK;
			} else {
				process.env.AUTH_ALLOW_QUERY_FALLBACK = previous;
			}
		}
	});

	it('allows JWT auth and propagates tenant header', async () => {
		const previousSecret = process.env.AUTH_JWT_SECRET;
		process.env.AUTH_JWT_SECRET = 'test-secret';

		try {
			const app = createApp();
			const token = jwtToken({
				role: 'manager',
				sub: 'jwt-user',
				tenantId: 'tenant-jwt',
			});
			const response = await app.request('/api/field/analytics/kpis', {
				headers: {
					authorization: `Bearer ${token}`,
				},
			});

			expect(response.status).toBe(200);
			expect(response.headers.get('x-tenant-id')).toBe('tenant-jwt');
		} finally {
			if (previousSecret === undefined) {
				delete process.env.AUTH_JWT_SECRET;
			} else {
				process.env.AUTH_JWT_SECRET = previousSecret;
			}
		}
	});

	it('rejects invalid JWT signature', async () => {
		const previousSecret = process.env.AUTH_JWT_SECRET;
		process.env.AUTH_JWT_SECRET = 'test-secret';

		try {
			const app = createApp();
			const token = jwtToken({
				role: 'manager',
				sub: 'jwt-user',
				tenantId: 'tenant-jwt',
			});
			const tampered = `${token}x`;
			const response = await app.request('/api/field/analytics/kpis', {
				headers: {
					authorization: `Bearer ${tampered}`,
				},
			});

			expect(response.status).toBe(401);
		} finally {
			if (previousSecret === undefined) {
				delete process.env.AUTH_JWT_SECRET;
			} else {
				process.env.AUTH_JWT_SECRET = previousSecret;
			}
		}
	});
});
