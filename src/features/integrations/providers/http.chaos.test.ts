import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	getObservabilitySnapshot,
	resetObservabilityForTests,
} from '../../../server/observability';
import {
	advanceNowForTests,
	freezeNowForTests,
	resetTestControlsForTests,
} from '../../../server/test-controls';
import {
	createHttpCrmAdapter,
	resetHttpIntegrationReliabilityForTests,
} from './http';

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

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

describe('http integration chaos resilience', () => {
	beforeEach(() => {
		restoreEnv();
		resetHttpIntegrationReliabilityForTests();
		resetObservabilityForTests();
		resetTestControlsForTests();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		restoreEnv();
		resetHttpIntegrationReliabilityForTests();
		resetObservabilityForTests();
		resetTestControlsForTests();
		vi.restoreAllMocks();
	});

	it('survives transient failure storms with retries', async () => {
		process.env.INTEGRATION_HTTP_RETRIES = '3';
		process.env.INTEGRATION_HTTP_RETRY_BASE_MS = '0';
		process.env.INTEGRATION_HTTP_CIRCUIT_FAILURE_THRESHOLD = '20';
		process.env.INTEGRATION_HTTP_CIRCUIT_COOLDOWN_MS = '1000';

		let callCount = 0;
		globalThis.fetch = vi.fn(async () => {
			callCount += 1;
			const phase = callCount % 3;
			if (phase === 1) {
				return new Response('upstream limited', { status: 429 });
			}
			if (phase === 2) {
				throw new Error('transient network reset');
			}
			return new Response(
				JSON.stringify({
					customerId: 'cust-storm',
					customerName: 'Storm Account',
					tier: 'enterprise',
					openServiceCount: 1,
					lastServiceAt: new Date().toISOString(),
					notes: [],
				}),
				{ status: 200, headers: { 'content-type': 'application/json' } },
			);
		}) as unknown as typeof fetch;

		const adapter = createHttpCrmAdapter('https://crm.example.test');
		for (let index = 0; index < 15; index += 1) {
			const response = await adapter.getCustomerContext(`cust-${index}`);
			expect(response?.customerId).toBe('cust-storm');
		}

		const snapshot = getObservabilitySnapshot({ windowMinutes: 60 });
		expect(snapshot.resilience.retryCount).toBeGreaterThan(0);
		expect(snapshot.resilience.circuitOpenCount).toBe(0);
	});

	it('opens circuit under sustained failures and recovers after cooldown', async () => {
		freezeNowForTests(1_700_000_000_000);
		process.env.INTEGRATION_HTTP_RETRIES = '0';
		process.env.INTEGRATION_HTTP_RETRY_BASE_MS = '0';
		process.env.INTEGRATION_HTTP_CIRCUIT_FAILURE_THRESHOLD = '2';
		process.env.INTEGRATION_HTTP_CIRCUIT_COOLDOWN_MS = '500';

		const fetchMock = vi
			.fn()
			.mockRejectedValueOnce(new Error('provider down #1'))
			.mockRejectedValueOnce(new Error('provider down #2'))
			.mockResolvedValue(
				new Response(
					JSON.stringify({
						customerId: 'cust-recovered',
						customerName: 'Recovered',
						tier: 'standard',
						openServiceCount: 0,
						lastServiceAt: new Date().toISOString(),
						notes: [],
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } },
				),
			);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const adapter = createHttpCrmAdapter('https://crm.example.test');

		await expect(adapter.getCustomerContext('cust-a')).rejects.toThrow();
		await expect(adapter.getCustomerContext('cust-b')).rejects.toThrow();
		await expect(adapter.getCustomerContext('cust-c')).rejects.toThrow(
			'circuit is open',
		);

		advanceNowForTests(600);
		const recovered = await adapter.getCustomerContext('cust-d');
		expect(recovered?.customerId).toBe('cust-recovered');

		const snapshot = getObservabilitySnapshot({ windowMinutes: 60 });
		expect(snapshot.resilience.circuitOpenCount).toBeGreaterThan(0);
		expect(snapshot.resilience.circuitShortCircuitCount).toBeGreaterThan(0);
	});
});
