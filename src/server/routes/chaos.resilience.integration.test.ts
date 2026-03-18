import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetFieldOpsStateForTests } from '../../features/field-ops';
import { resetDisruptionFeedProviderForTests } from '../../features/field-ops/disruption-feed';
import { resetFieldIntelligenceProviderForTests } from '../../features/field-ops/intelligence-provider';
import { resetIntegrationStateForTests } from '../../features/integrations';
import { createApp } from '../app';
import { resetBackgroundJobsForTests } from '../background-jobs';
import { resetObservabilityForTests } from '../observability';
import { resetRateLimiterForTests } from '../rate-limit';

const managerHeaders = {
	authorization: 'Bearer manager:chaos-suite',
};
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

describe('chaos resilience integration', () => {
	beforeEach(async () => {
		restoreEnv();
		resetFieldOpsStateForTests();
		resetDisruptionFeedProviderForTests();
		resetFieldIntelligenceProviderForTests();
		await resetIntegrationStateForTests();
		await resetBackgroundJobsForTests();
		resetObservabilityForTests();
		resetRateLimiterForTests();
	});

	afterEach(() => {
		restoreEnv();
		resetFieldIntelligenceProviderForTests();
	});

	it('falls back to local intelligence strategy when provider is unavailable', async () => {
		process.env.FIELD_INTELLIGENCE_PROVIDER = 'http';
		process.env.FIELD_INTELLIGENCE_BASE_URL = 'http://127.0.0.1:9';
		process.env.FIELD_INTELLIGENCE_HTTP_TIMEOUT_MS = '100';
		resetFieldIntelligenceProviderForTests();

		const app = createApp();
		const intelligenceResponse = await app.request(
			'/api/field/jobs/job-100/intelligence',
			{
				method: 'POST',
				headers: {
					...managerHeaders,
					'content-type': 'application/json',
				},
				body: JSON.stringify({
					symptoms: ['intermittent power'],
					notes: 'chaos fallback check',
				}),
			},
		);

		expect(intelligenceResponse.status).toBe(200);
		expect(
			intelligenceResponse.headers.get('x-intelligence-provider-warning'),
		).toBe('provider-fallback');

		const metricsResponse = await app.request(
			'/api/field/observability/metrics?windowMinutes=60',
			{
				headers: managerHeaders,
			},
		);

		expect(metricsResponse.status).toBe(200);
		const body = (await metricsResponse.json()) as {
			metrics: { resilience?: { fallbackCount?: number } };
		};
		expect(body.metrics.resilience?.fallbackCount ?? 0).toBeGreaterThan(0);
	});
});
