import { beforeEach, describe, expect, it } from 'vitest';
import {
	resetFieldOpsStateForTests,
	updateTechnicianShift,
} from '../../features/field-ops';
import { resetDisruptionFeedProviderForTests } from '../../features/field-ops/disruption-feed';
import { resetFieldIntelligenceProviderForTests } from '../../features/field-ops/intelligence-provider';
import { resetIntegrationStateForTests } from '../../features/integrations';
import { createApp } from '../app';
import { resetBackgroundJobsForTests } from '../background-jobs';
import { resetObservabilityForTests } from '../observability';
import { resetRateLimiterForTests } from '../rate-limit';
import {
	automationCycleResponseSchema,
	optimizeResponseSchema,
} from './dispatch.contract.schemas';

const managerHeaders = {
	authorization: 'Bearer manager:dispatch-contract',
};

describe('dispatch API contract', () => {
	beforeEach(async () => {
		resetFieldOpsStateForTests();
		resetDisruptionFeedProviderForTests();
		resetFieldIntelligenceProviderForTests();
		await resetIntegrationStateForTests();
		await resetBackgroundJobsForTests();
		resetObservabilityForTests();
		resetRateLimiterForTests();

		updateTechnicianShift({
			technicianId: 'tech-a1',
			start: '00:00',
			end: '23:59',
		});
		updateTechnicianShift({
			technicianId: 'tech-b2',
			start: '00:00',
			end: '23:59',
		});
		updateTechnicianShift({
			technicianId: 'tech-c3',
			start: '00:00',
			end: '23:59',
		});
	});

	it('returns optimize contract payload', async () => {
		const app = createApp();
		const response = await app.request('/api/field/dispatch/optimize', {
			method: 'POST',
			headers: managerHeaders,
			body: JSON.stringify({
				includeAssigned: true,
				reason: 'contract validation',
			}),
		});

		expect(response.status).toBe(200);
		const body = optimizeResponseSchema.parse(await response.json());
		expect(body.totalCandidateJobs).toBeGreaterThan(0);
	});

	it('returns automation cycle contract payload', async () => {
		const previousMockEnabled = process.env.MOCK_DISRUPTION_ENABLED;
		process.env.MOCK_DISRUPTION_ENABLED = 'true';
		resetDisruptionFeedProviderForTests();

		try {
			const app = createApp();
			const response = await app.request(
				'/api/field/ops/automation/run-cycle',
				{
					method: 'POST',
					headers: managerHeaders,
					body: JSON.stringify({
						runAutoDisruption: true,
						runOptimization: true,
						includeAssigned: true,
						maxSignals: 5,
					}),
				},
			);

			expect(response.status).toBe(200);
			const body = automationCycleResponseSchema.parse(await response.json());
			expect(body.disruption).toBeTruthy();
			expect(body.optimization).toBeTruthy();
			expect(body.driftAlerts).toBeDefined();
			expect(body.metrics).toBeTruthy();
			expect(typeof body.metrics?.totalRequests).toBe('number');
		} finally {
			if (previousMockEnabled === undefined) {
				delete process.env.MOCK_DISRUPTION_ENABLED;
			} else {
				process.env.MOCK_DISRUPTION_ENABLED = previousMockEnabled;
			}
			resetDisruptionFeedProviderForTests();
		}
	});

	it('enforces auth on optimize and automation endpoints', async () => {
		const app = createApp();

		const optimizeUnauthorized = await app.request(
			'/api/field/dispatch/optimize',
			{
				method: 'POST',
				body: JSON.stringify({ includeAssigned: true }),
			},
		);
		expect(optimizeUnauthorized.status).toBe(401);

		const automationUnauthorized = await app.request(
			'/api/field/ops/automation/run-cycle',
			{
				method: 'POST',
				body: JSON.stringify({
					runAutoDisruption: true,
					runOptimization: true,
				}),
			},
		);
		expect(automationUnauthorized.status).toBe(401);
	});
});
