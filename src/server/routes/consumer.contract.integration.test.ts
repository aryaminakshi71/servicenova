import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
import { optimizeResponseSchema } from './dispatch.contract.schemas';
import {
	dashboardOnboardingResponseSchema,
	driftAlertsResponseSchema,
	healthResponseSchema,
	incidentTimelineResponseSchema,
	observabilityMetricsResponseSchema,
} from './platform.contract.schemas';

type ConsumerInteraction = {
	name: string;
	method: 'GET' | 'POST';
	path: string;
	headers?: Record<string, string>;
	body?: unknown;
	expectStatus: number;
	schema:
		| 'health'
		| 'dispatch-optimize'
		| 'observability-metrics'
		| 'dashboard-onboarding'
		| 'drift-alerts'
		| 'ops-incidents';
};

type ConsumerFixture = {
	consumer: string;
	provider: string;
	version: string;
	interactions: ConsumerInteraction[];
};

const fixturePath = resolve(
	process.cwd(),
	'contracts/consumers/dispatch-dashboard.v1.json',
);
const fixture = JSON.parse(
	readFileSync(fixturePath, 'utf8'),
) as ConsumerFixture;

const schemaParsers = {
	health: healthResponseSchema,
	'dispatch-optimize': optimizeResponseSchema,
	'observability-metrics': observabilityMetricsResponseSchema,
	'dashboard-onboarding': dashboardOnboardingResponseSchema,
	'drift-alerts': driftAlertsResponseSchema,
	'ops-incidents': incidentTimelineResponseSchema,
} as const;

describe('consumer-driven API contracts', () => {
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

	it('validates consumer fixture interactions against provider schemas', async () => {
		const app = createApp();
		expect(fixture.provider).toBe('servicenova-ai');
		expect(fixture.interactions.length).toBeGreaterThan(0);

		for (const interaction of fixture.interactions) {
			const response = await app.request(interaction.path, {
				method: interaction.method,
				headers: interaction.headers,
				body: interaction.body ? JSON.stringify(interaction.body) : undefined,
			});

			expect(response.status).toBe(interaction.expectStatus);
			const parser = schemaParsers[interaction.schema];
			parser.parse(await response.json());
		}
	});
});
