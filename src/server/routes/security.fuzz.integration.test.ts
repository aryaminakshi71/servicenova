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

const managerHeaders = {
	authorization: 'Bearer manager:security-fuzz',
};

function createPayloadGenerator(seed = 1337) {
	let state = seed >>> 0;
	const nextInt = () => {
		state = (state * 1_664_525 + 1_013_904_223) >>> 0;
		return state;
	};

	return () => {
		const roll = nextInt() % 7;
		if (roll === 0) {
			return { random: nextInt() };
		}
		if (roll === 1) {
			return { items: [nextInt(), null, 'oops'] };
		}
		if (roll === 2) {
			return { jobId: '', technicianId: ['bad'] };
		}
		if (roll === 3) {
			return { type: 'traffic_incident', reason: nextInt() };
		}
		if (roll === 4) {
			return { operations: [{ type: 'unknown', payload: {} }] };
		}
		if (roll === 5) {
			return { runId: nextInt(), action: 'invalid' };
		}
		return [nextInt(), 'array-payload', { nested: true }];
	};
}

describe('security fuzz', () => {
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
	});

	it('does not return 5xx for malformed payloads on critical mutation endpoints', async () => {
		const app = createApp();
		const endpoints = [
			'/api/field/jobs/assign',
			'/api/field/jobs/reassign',
			'/api/field/jobs/job-100/checklist',
			'/api/field/dispatch/disruptions',
			'/api/field/mobile/sync',
			'/api/field/jobs/job-100/intelligence/confirm',
		];

		for (const endpoint of endpoints) {
			const response = await app.request(endpoint, {
				method: 'POST',
				headers: {
					...managerHeaders,
					'content-type': 'application/json',
				},
				body: JSON.stringify({ invalid: true, payload: [null, {}, 'bad'] }),
			});

			expect(response.status).toBeLessThan(500);
		}
	});

	it('keeps fuzzed authenticated traffic fail-safe (no 5xx)', async () => {
		const app = createApp();
		const nextPayload = createPayloadGenerator();
		const targets = [
			'/api/field/jobs/assign',
			'/api/field/dispatch/disruptions',
			'/api/field/jobs/job-100/checklist',
			'/api/field/mobile/sync',
			'/api/field/jobs/job-100/intelligence/confirm',
		];

		for (let attempt = 0; attempt < 40; attempt += 1) {
			const endpoint = targets[attempt % targets.length] ?? targets[0];
			const response = await app.request(endpoint, {
				method: 'POST',
				headers: {
					...managerHeaders,
					'content-type': 'application/json',
				},
				body: JSON.stringify(nextPayload()),
			});

			expect(response.status).toBeLessThan(500);
		}
	});

	it('rejects unauthenticated fuzz attempts on protected routes', async () => {
		const app = createApp();
		const endpoints = [
			'/api/field/jobs/assign',
			'/api/field/dispatch/disruptions',
			'/api/field/integrations/outbox/flush',
		];

		for (const endpoint of endpoints) {
			const response = await app.request(endpoint, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
				},
				body: JSON.stringify({ fuzz: true }),
			});

			expect(response.status).toBe(401);
		}
	});
});
