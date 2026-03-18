import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import {
	getObservabilitySnapshot,
	recordResilienceEvent,
	requestTracing,
	resetObservabilityForTests,
} from './observability';

describe('observability metrics', () => {
	it('captures request samples and computes snapshot stats', async () => {
		resetObservabilityForTests();
		const app = new Hono();
		app.use('*', requestTracing());
		app.get('/ok', (c) => c.json({ ok: true }));
		app.get('/boom', (c) => c.json({ error: true }, 500));

		await app.request('/ok');
		await app.request('/ok');
		await app.request('/boom');

		const snapshot = getObservabilitySnapshot({ windowMinutes: 60 });
		expect(snapshot.totalRequests).toBeGreaterThanOrEqual(3);
		expect(snapshot.routes.length).toBeGreaterThan(0);
		expect(snapshot.errorRate).toBeGreaterThan(0);
		expect(snapshot.resilience.totalEvents).toBe(0);
	});

	it('aggregates resilience events', () => {
		resetObservabilityForTests();

		recordResilienceEvent({
			tenantId: 'tenant-a',
			type: 'integration_retry',
			service: 'crm',
			operation: 'get-customer-context',
		});
		recordResilienceEvent({
			tenantId: 'tenant-a',
			type: 'integration_circuit_open',
			service: 'crm',
			operation: 'get-customer-context',
		});

		const snapshot = getObservabilitySnapshot({
			windowMinutes: 60,
			tenantId: 'tenant-a',
		});
		expect(snapshot.resilience.totalEvents).toBe(2);
		expect(snapshot.resilience.retryCount).toBe(1);
		expect(snapshot.resilience.circuitOpenCount).toBe(1);
	});
});
