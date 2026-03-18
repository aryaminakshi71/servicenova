import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('http integration reliability', () => {
	beforeEach(() => {
		restoreEnv();
		resetHttpIntegrationReliabilityForTests();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		restoreEnv();
		resetHttpIntegrationReliabilityForTests();
		vi.restoreAllMocks();
	});

	it('retries transient CRM failures and eventually succeeds', async () => {
		process.env.INTEGRATION_HTTP_RETRIES = '2';
		process.env.INTEGRATION_HTTP_RETRY_BASE_MS = '0';
		process.env.INTEGRATION_HTTP_CIRCUIT_FAILURE_THRESHOLD = '5';

		const customer = {
			customerId: 'cust-101',
			customerName: 'Aster Tower Ops',
			tier: 'enterprise',
			openServiceCount: 2,
			lastServiceAt: new Date().toISOString(),
			notes: ['24/7 coverage'],
		} as const;

		const fetchMock = vi
			.fn()
			.mockRejectedValueOnce(new Error('temporary network issue'))
			.mockResolvedValueOnce(
				new Response(JSON.stringify(customer), {
					status: 200,
					headers: {
						'content-type': 'application/json',
					},
				}),
			);

		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const adapter = createHttpCrmAdapter('https://crm.example.test');
		const result = await adapter.getCustomerContext('cust-101');

		expect(result?.customerId).toBe('cust-101');
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('opens a circuit after repeated failures and short-circuits subsequent calls', async () => {
		process.env.INTEGRATION_HTTP_RETRIES = '0';
		process.env.INTEGRATION_HTTP_RETRY_BASE_MS = '0';
		process.env.INTEGRATION_HTTP_CIRCUIT_FAILURE_THRESHOLD = '2';
		process.env.INTEGRATION_HTTP_CIRCUIT_COOLDOWN_MS = '60000';

		const fetchMock = vi.fn().mockRejectedValue(new Error('provider down'));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const adapter = createHttpCrmAdapter('https://crm.example.test');

		await expect(adapter.getCustomerContext('cust-101')).rejects.toThrow();
		await expect(adapter.getCustomerContext('cust-101')).rejects.toThrow();
		await expect(adapter.getCustomerContext('cust-101')).rejects.toThrow(
			'circuit is open',
		);

		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});
