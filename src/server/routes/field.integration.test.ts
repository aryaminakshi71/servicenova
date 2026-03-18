import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	resetFieldOpsStateForTests,
	updateTechnicianShift,
} from '../../features/field-ops';
import { resetDisruptionFeedProviderForTests } from '../../features/field-ops/disruption-feed';
import { resetFieldIntelligenceProviderForTests } from '../../features/field-ops/intelligence-provider';
import { JOB_LIFECYCLE_ERROR_CODES } from '../../features/field-ops/service';
import { resetIntegrationStateForTests } from '../../features/integrations';
import { createApp } from '../app';
import { resetBackgroundJobsForTests } from '../background-jobs';
import { resetObservabilityForTests } from '../observability';
import { resetRateLimiterForTests } from '../rate-limit';
import { resetFieldRouteStateForTests } from './field';
import {
	dashboardOnboardingResponseSchema,
	driftAlertAcknowledgeResponseSchema,
	driftAlertsResponseSchema,
	healthResponseSchema,
	incidentTimelineResponseSchema,
	integrationOutboxFlushResponseSchema,
	integrationOutboxListResponseSchema,
	observabilityMetricsResponseSchema,
} from './platform.contract.schemas';

async function jsonOf<T>(response: Response): Promise<T> {
	return (await response.json()) as T;
}

function parseSsePayload<T>(chunkText: string): T {
	const line = chunkText
		.split('\n')
		.find((candidate) => candidate.startsWith('data: '));

	if (!line) {
		throw new Error(`Missing SSE payload in chunk: ${chunkText}`);
	}

	return JSON.parse(line.slice('data: '.length)) as T;
}

const authHeaders = {
	authorization: 'Bearer manager:integration-test',
};

describe('field API integration', () => {
	beforeEach(async () => {
		resetFieldOpsStateForTests();
		resetFieldRouteStateForTests();
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

	it('returns health status', async () => {
		const app = createApp();
		const response = await app.request('/api/health');

		expect(response.status).toBe(200);

		const body = healthResponseSchema.parse(await response.json());
		expect(body.ok).toBe(true);
	});

	it('rejects invalid assignment payload', async () => {
		const app = createApp();
		const response = await app.request('/api/field/jobs/assign', {
			method: 'POST',
			headers: authHeaders,
			body: JSON.stringify({}),
		});

		expect(response.status).toBe(400);
	});

	it('handles dispatch disruptions and returns impact summary', async () => {
		const app = createApp();
		const response = await app.request('/api/field/dispatch/disruptions', {
			method: 'POST',
			headers: authHeaders,
			body: JSON.stringify({
				type: 'technician_unavailable',
				technicianId: 'tech-c3',
				reason: 'Vehicle breakdown',
			}),
		});

		expect(response.status).toBe(200);
		const body = await jsonOf<{
			type: string;
			impactedJobIds: string[];
			reassignedJobIds: string[];
			queuedJobIds: string[];
			blockedJobIds: string[];
		}>(response);
		expect(body.type).toBe('technician_unavailable');
		expect(body.impactedJobIds.length).toBeGreaterThan(0);
		expect(
			body.reassignedJobIds.length +
				body.queuedJobIds.length +
				body.blockedJobIds.length,
		).toBeGreaterThan(0);
	});

	it('runs dispatch optimizer and returns assignment plan', async () => {
		const app = createApp();
		const response = await app.request('/api/field/dispatch/optimize', {
			method: 'POST',
			headers: authHeaders,
			body: JSON.stringify({
				includeAssigned: true,
				reason: 'shift balancing',
			}),
		});

		expect(response.status).toBe(200);
		const body = await jsonOf<{
			totalCandidateJobs: number;
			assignments: Array<{ jobId: string; toTechnicianId: string }>;
		}>(response);
		expect(body.totalCandidateJobs).toBeGreaterThan(0);
		expect(body.assignments.length).toBeGreaterThan(0);
	});

	it('queues async dispatch optimizer jobs and exposes job status', async () => {
		const app = createApp();
		const queued = await app.request('/api/field/dispatch/optimize', {
			method: 'POST',
			headers: authHeaders,
			body: JSON.stringify({
				includeAssigned: true,
				async: true,
			}),
		});

		expect(queued.status).toBe(202);
		const queuedBody = await jsonOf<{ job: { id: string; status: string } }>(
			queued,
		);
		expect(queuedBody.job.id).toBeTypeOf('string');

		const job = await app.request(`/api/field/ops/jobs/${queuedBody.job.id}`, {
			headers: authHeaders,
		});

		expect(job.status).toBe(200);
		const jobBody = await jsonOf<{ job: { status: string; result: unknown } }>(
			job,
		);
		expect(['queued', 'running', 'completed']).toContain(jobBody.job.status);
	});

	it('runs auto disruption sweep from provider', async () => {
		const previousMockEnabled = process.env.MOCK_DISRUPTION_ENABLED;
		process.env.MOCK_DISRUPTION_ENABLED = 'true';
		resetDisruptionFeedProviderForTests();

		try {
			const app = createApp();
			const response = await app.request(
				'/api/field/dispatch/disruptions/auto-run',
				{
					method: 'POST',
					headers: authHeaders,
					body: JSON.stringify({
						maxSignals: 3,
					}),
				},
			);

			expect(response.status).toBe(200);
			const body = await jsonOf<{
				detectedSignals: number;
				processedSignals: number;
			}>(response);
			expect(body.detectedSignals).toBeGreaterThan(0);
			expect(body.processedSignals).toBeGreaterThan(0);
		} finally {
			if (previousMockEnabled === undefined) {
				delete process.env.MOCK_DISRUPTION_ENABLED;
			} else {
				process.env.MOCK_DISRUPTION_ENABLED = previousMockEnabled;
			}
			resetDisruptionFeedProviderForTests();
		}
	});

	it('returns work-order intelligence for an existing job', async () => {
		const app = createApp();
		const response = await app.request('/api/field/jobs/job-100/intelligence', {
			method: 'POST',
			headers: authHeaders,
			body: JSON.stringify({
				symptoms: ['compressor fault', 'overheat warning'],
				notes: 'Breaker tripped twice during startup',
			}),
		});

		expect(response.status).toBe(200);
		const body = await jsonOf<{
			result: {
				jobId: string;
				probableDiagnoses: Array<{ label: string }>;
				recommendedParts: string[];
			};
		}>(response);
		expect(body.result.jobId).toBe('job-100');
		expect(body.result.probableDiagnoses.length).toBeGreaterThan(0);
		expect(body.result.recommendedParts.length).toBeGreaterThan(0);
	});

	it('applies low-confidence guardrail and supports dispatcher confirmation', async () => {
		const previousThreshold =
			process.env.INTELLIGENCE_AUTO_ACTION_MIN_CONFIDENCE;
		process.env.INTELLIGENCE_AUTO_ACTION_MIN_CONFIDENCE = '0.99';

		try {
			const app = createApp();
			const intelligence = await app.request(
				'/api/field/jobs/job-100/intelligence',
				{
					method: 'POST',
					headers: authHeaders,
					body: JSON.stringify({
						symptoms: ['compressor fault'],
					}),
				},
			);

			expect(intelligence.status).toBe(200);
			expect(intelligence.headers.get('x-intelligence-guardrail')).toBe(
				'recommendation-only',
			);
			const intelligenceBody = await jsonOf<{
				result: { runId?: string };
				guardrail: { requiresConfirmation: boolean };
			}>(intelligence);
			expect(intelligenceBody.guardrail.requiresConfirmation).toBe(true);
			expect(intelligenceBody.result.runId).toBeTypeOf('string');

			const confirm = await app.request(
				'/api/field/jobs/job-100/intelligence/confirm',
				{
					method: 'POST',
					headers: authHeaders,
					body: JSON.stringify({
						runId: intelligenceBody.result.runId,
						action: 'auto_dispatch',
					}),
				},
			);

			expect(confirm.status).toBe(200);
			const confirmBody = await jsonOf<{
				confirmed: boolean;
				bypassedGuardrail: boolean;
			}>(confirm);
			expect(confirmBody.confirmed).toBe(true);
			expect(confirmBody.bypassedGuardrail).toBe(true);
		} finally {
			if (previousThreshold === undefined) {
				delete process.env.INTELLIGENCE_AUTO_ACTION_MIN_CONFIDENCE;
			} else {
				process.env.INTELLIGENCE_AUTO_ACTION_MIN_CONFIDENCE = previousThreshold;
			}
		}
	});

	it('returns 404 for work-order intelligence on unknown job', async () => {
		const app = createApp();
		const response = await app.request(
			'/api/field/jobs/job-missing/intelligence',
			{
				method: 'POST',
				headers: authHeaders,
				body: JSON.stringify({
					symptoms: ['pressure issue'],
				}),
			},
		);

		expect(response.status).toBe(404);
	});

	it('returns technician assist briefing for an existing job', async () => {
		const app = createApp();
		const response = await app.request(
			'/api/field/jobs/job-100/assist/briefing',
			{
				method: 'POST',
				headers: authHeaders,
				body: JSON.stringify({
					noteContext: 'Customer reports repeated shutdown after 10 minutes',
				}),
			},
		);

		expect(response.status).toBe(200);
		const body = await jsonOf<{
			result: {
				jobId: string;
				recommendedSteps: string[];
				smartFormFields: string[];
			};
		}>(response);
		expect(body.result.jobId).toBe('job-100');
		expect(body.result.recommendedSteps.length).toBeGreaterThan(0);
		expect(body.result.smartFormFields.length).toBeGreaterThan(0);
	});

	it('returns 404 for technician assist briefing on unknown job', async () => {
		const app = createApp();
		const response = await app.request(
			'/api/field/jobs/job-missing/assist/briefing',
			{
				method: 'POST',
				headers: authHeaders,
				body: JSON.stringify({}),
			},
		);

		expect(response.status).toBe(404);
	});

	it('returns intelligence history and accuracy metrics', async () => {
		const app = createApp();

		const intelligence = await app.request(
			'/api/field/jobs/job-100/intelligence',
			{
				method: 'POST',
				headers: authHeaders,
				body: JSON.stringify({
					symptoms: ['compressor fault'],
				}),
			},
		);
		expect(intelligence.status).toBe(200);

		const assist = await app.request(
			'/api/field/jobs/job-100/assist/briefing',
			{
				method: 'POST',
				headers: authHeaders,
				body: JSON.stringify({}),
			},
		);
		expect(assist.status).toBe(200);

		await app.request('/api/field/jobs/assign', {
			method: 'POST',
			headers: authHeaders,
			body: JSON.stringify({ jobId: 'job-100' }),
		});
		await app.request('/api/field/jobs/job-100/start', {
			method: 'POST',
			headers: authHeaders,
			body: JSON.stringify({}),
		});
		await app.request('/api/field/jobs/job-100/checklist', {
			method: 'POST',
			headers: authHeaders,
			body: JSON.stringify({
				items: [
					{ id: 'site-safety', done: true },
					{ id: 'verify-asset', done: true },
				],
			}),
		});
		await app.request('/api/field/jobs/job-100/complete', {
			method: 'POST',
			headers: authHeaders,
			body: JSON.stringify({}),
		});

		const history = await app.request(
			'/api/field/intelligence/history?jobId=job-100&limit=10',
			{
				headers: authHeaders,
			},
		);
		expect(history.status).toBe(200);

		const historyBody = await jsonOf<{
			workOrderRuns: Array<{ jobId: string }>;
			assistBriefings: Array<{ jobId: string }>;
		}>(history);
		expect(historyBody.workOrderRuns.length).toBeGreaterThan(0);
		expect(historyBody.assistBriefings.length).toBeGreaterThan(0);
		expect(
			historyBody.workOrderRuns.every((run) => run.jobId === 'job-100'),
		).toBe(true);

		const accuracy = await app.request(
			'/api/field/intelligence/accuracy?jobId=job-100',
			{
				headers: authHeaders,
			},
		);
		expect(accuracy.status).toBe(200);
		const accuracyBody = await jsonOf<{ accuracy: { sampleCount: number } }>(
			accuracy,
		);
		expect(accuracyBody.accuracy.sampleCount).toBeGreaterThan(0);
	});

	it('returns intelligence quality report segments', async () => {
		const app = createApp();

		await app.request('/api/field/jobs/job-100/intelligence', {
			method: 'POST',
			headers: authHeaders,
			body: JSON.stringify({ symptoms: ['fault'] }),
		});
		await app.request('/api/field/jobs/assign', {
			method: 'POST',
			headers: authHeaders,
			body: JSON.stringify({ jobId: 'job-100' }),
		});
		await app.request('/api/field/jobs/job-100/start', {
			method: 'POST',
			headers: authHeaders,
			body: JSON.stringify({}),
		});
		await app.request('/api/field/jobs/job-100/checklist', {
			method: 'POST',
			headers: authHeaders,
			body: JSON.stringify({
				items: [
					{ id: 'site-safety', done: true },
					{ id: 'verify-asset', done: true },
				],
			}),
		});
		await app.request('/api/field/jobs/job-100/complete', {
			method: 'POST',
			headers: authHeaders,
			body: JSON.stringify({}),
		});

		const response = await app.request(
			'/api/field/intelligence/quality-report?windowHours=48',
			{
				headers: authHeaders,
			},
		);
		expect(response.status).toBe(200);
		const body = await jsonOf<{
			report: { overall: { sampleCount: number }; byPriority: unknown[] };
		}>(response);
		expect(body.report.overall.sampleCount).toBeGreaterThan(0);
		expect(body.report.byPriority.length).toBeGreaterThan(0);
	});

	it('returns intelligence drift alerts when thresholds are strict', async () => {
		const app = createApp();

		await app.request('/api/field/jobs/job-100/intelligence', {
			method: 'POST',
			headers: authHeaders,
			body: JSON.stringify({ symptoms: ['fault'] }),
		});
		await app.request('/api/field/jobs/assign', {
			method: 'POST',
			headers: authHeaders,
			body: JSON.stringify({ jobId: 'job-100' }),
		});
		await app.request('/api/field/jobs/job-100/start', {
			method: 'POST',
			headers: authHeaders,
			body: JSON.stringify({}),
		});
		await app.request('/api/field/jobs/job-100/checklist', {
			method: 'POST',
			headers: authHeaders,
			body: JSON.stringify({
				items: [
					{ id: 'site-safety', done: true },
					{ id: 'verify-asset', done: true },
				],
			}),
		});
		await app.request('/api/field/jobs/job-100/complete', {
			method: 'POST',
			headers: authHeaders,
			body: JSON.stringify({}),
		});

		const previousMaxMae = process.env.INTELLIGENCE_DRIFT_MAX_MAE_MINUTES;
		process.env.INTELLIGENCE_DRIFT_MAX_MAE_MINUTES = '0.1';

		try {
			const response = await app.request(
				'/api/field/intelligence/drift-alerts?windowHours=48&minSampleCount=1',
				{
					headers: authHeaders,
				},
			);
			expect(response.status).toBe(200);
			const body = await jsonOf<{ alerts: Array<{ severity: string }> }>(
				response,
			);
			expect(body.alerts.length).toBeGreaterThan(0);
		} finally {
			if (previousMaxMae === undefined) {
				delete process.env.INTELLIGENCE_DRIFT_MAX_MAE_MINUTES;
			} else {
				process.env.INTELLIGENCE_DRIFT_MAX_MAE_MINUTES = previousMaxMae;
			}
		}
	});

	it('persists onboarding checklist state per user and tenant', async () => {
		const app = createApp();
		const baseline = await app.request('/api/field/dashboard/onboarding', {
			headers: authHeaders,
		});

		expect(baseline.status).toBe(200);
		const baselineBody = dashboardOnboardingResponseSchema.parse(
			await baseline.json(),
		);
		expect(baselineBody.onboarding.selectedJob).toBe(false);

		const update = await app.request('/api/field/dashboard/onboarding', {
			method: 'POST',
			headers: authHeaders,
			body: JSON.stringify({
				selectedJob: true,
				intelligenceRun: true,
				dismissed: true,
			}),
		});
		expect(update.status).toBe(200);

		const current = await app.request('/api/field/dashboard/onboarding', {
			headers: authHeaders,
		});
		expect(current.status).toBe(200);
		const currentBody = dashboardOnboardingResponseSchema.parse(
			await current.json(),
		);
		expect(currentBody.onboarding.selectedJob).toBe(true);
		expect(currentBody.onboarding.intelligenceRun).toBe(true);
		expect(currentBody.onboarding.dismissed).toBe(true);

		const differentUser = await app.request('/api/field/dashboard/onboarding', {
			headers: {
				authorization: 'Bearer manager:integration-test-alt-user',
			},
		});
		expect(differentUser.status).toBe(200);
		const differentUserBody = dashboardOnboardingResponseSchema.parse(
			await differentUser.json(),
		);
		expect(differentUserBody.onboarding.selectedJob).toBe(false);
		expect(differentUserBody.onboarding.dismissed).toBe(false);

		const differentTenant = await app.request(
			'/api/field/dashboard/onboarding',
			{
				headers: {
					authorization: 'Bearer manager:integration-test:tenant-b',
				},
			},
		);
		expect(differentTenant.status).toBe(200);
		const differentTenantBody = dashboardOnboardingResponseSchema.parse(
			await differentTenant.json(),
		);
		expect(differentTenantBody.onboarding.selectedJob).toBe(false);
		expect(differentTenantBody.onboarding.dismissed).toBe(false);
	});

	it('acknowledges drift alerts with owner and SLA metadata', async () => {
		const app = createApp();

		await app.request('/api/field/jobs/job-100/intelligence', {
			method: 'POST',
			headers: authHeaders,
			body: JSON.stringify({ symptoms: ['fault'] }),
		});
		await app.request('/api/field/jobs/assign', {
			method: 'POST',
			headers: authHeaders,
			body: JSON.stringify({ jobId: 'job-100' }),
		});
		await app.request('/api/field/jobs/job-100/start', {
			method: 'POST',
			headers: authHeaders,
			body: JSON.stringify({}),
		});
		await app.request('/api/field/jobs/job-100/checklist', {
			method: 'POST',
			headers: authHeaders,
			body: JSON.stringify({
				items: [
					{ id: 'site-safety', done: true },
					{ id: 'verify-asset', done: true },
				],
			}),
		});
		await app.request('/api/field/jobs/job-100/complete', {
			method: 'POST',
			headers: authHeaders,
			body: JSON.stringify({}),
		});

		const previousMaxMae = process.env.INTELLIGENCE_DRIFT_MAX_MAE_MINUTES;
		process.env.INTELLIGENCE_DRIFT_MAX_MAE_MINUTES = '0.1';

		try {
			const drift = await app.request(
				'/api/field/intelligence/drift-alerts?windowHours=48&minSampleCount=1',
				{
					headers: authHeaders,
				},
			);
			expect(drift.status).toBe(200);
			const driftBody = driftAlertsResponseSchema.parse(await drift.json());
			expect(driftBody.alerts.length).toBeGreaterThan(0);

			const alertId = driftBody.alerts[0].id;
			const acknowledge = await app.request(
				`/api/field/intelligence/drift-alerts/${alertId}/acknowledge`,
				{
					method: 'POST',
					headers: authHeaders,
					body: JSON.stringify({
						owner: 'ops-oncall',
						slaDueAt: '2030-01-01T00:00:00.000Z',
						note: 'Investigating model drift',
					}),
				},
			);
			expect(acknowledge.status).toBe(200);
			const acknowledgeBody = driftAlertAcknowledgeResponseSchema.parse(
				await acknowledge.json(),
			);
			expect(acknowledgeBody.acknowledgement.alertId).toBe(alertId);
			expect(acknowledgeBody.acknowledgement.owner).toBe('ops-oncall');

			const postAcknowledge = await app.request(
				'/api/field/intelligence/drift-alerts?windowHours=48&minSampleCount=1',
				{
					headers: authHeaders,
				},
			);
			expect(postAcknowledge.status).toBe(200);
			const postBody = driftAlertsResponseSchema.parse(
				await postAcknowledge.json(),
			);
			const matched = postBody.alerts.find((item) => item.id === alertId);
			expect(matched?.acknowledged).toBe(true);
			expect(matched?.acknowledgement?.owner).toBe('ops-oncall');
			expect(matched?.acknowledgement?.slaDueAt).toBe(
				'2030-01-01T00:00:00.000Z',
			);
			expect(matched?.acknowledgement?.note).toBe('Investigating model drift');
		} finally {
			if (previousMaxMae === undefined) {
				delete process.env.INTELLIGENCE_DRIFT_MAX_MAE_MINUTES;
			} else {
				process.env.INTELLIGENCE_DRIFT_MAX_MAE_MINUTES = previousMaxMae;
			}
		}
	});

	it('exposes incident timeline list and realtime stream', async () => {
		const app = createApp();

		await app.request('/api/field/dispatch/optimize', {
			method: 'POST',
			headers: authHeaders,
			body: JSON.stringify({ includeAssigned: true }),
		});

		const intelligence = await app.request(
			'/api/field/jobs/job-100/intelligence',
			{
				method: 'POST',
				headers: authHeaders,
				body: JSON.stringify({
					symptoms: ['compressor fault'],
				}),
			},
		);
		expect(intelligence.status).toBe(200);
		const intelligenceBody = await jsonOf<{ result: { runId?: string } }>(
			intelligence,
		);
		expect(intelligenceBody.result.runId).toBeTypeOf('string');

		const confirm = await app.request(
			'/api/field/jobs/job-100/intelligence/confirm',
			{
				method: 'POST',
				headers: authHeaders,
				body: JSON.stringify({
					runId: intelligenceBody.result.runId,
					action: 'auto_dispatch',
				}),
			},
		);
		expect(confirm.status).toBe(200);

		const list = await app.request('/api/field/ops/incidents?limit=20', {
			headers: authHeaders,
		});
		expect(list.status).toBe(200);
		const listBody = incidentTimelineResponseSchema.parse(await list.json());
		expect(listBody.incidents.length).toBeGreaterThan(0);
		expect(
			listBody.incidents.some(
				(item) =>
					item.type === 'dispatch_optimization_completed' ||
					item.type === 'intelligence_action_confirmed',
			),
		).toBe(true);

		const stream = await app.request(
			'/api/field/ops/incidents/stream?limit=5',
			{
				headers: authHeaders,
			},
		);
		expect(stream.status).toBe(200);
		expect(stream.headers.get('content-type')).toContain('text/event-stream');
		const reader = stream.body?.getReader();
		expect(reader).toBeDefined();
		const firstChunk = await reader?.read();
		const chunkText = new TextDecoder().decode(
			firstChunk?.value ?? new Uint8Array(),
		);
		expect(chunkText).toContain('"type":"ops-incidents"');
		await reader?.cancel();
	});

	it('runs manager automation cycle orchestration', async () => {
		const previousMockEnabled = process.env.MOCK_DISRUPTION_ENABLED;
		process.env.MOCK_DISRUPTION_ENABLED = 'true';
		resetDisruptionFeedProviderForTests();

		try {
			const app = createApp();
			await app.request('/api/field/dispatch-board', {
				headers: authHeaders,
			});
			const response = await app.request(
				'/api/field/ops/automation/run-cycle',
				{
					method: 'POST',
					headers: authHeaders,
					body: JSON.stringify({
						runAutoDisruption: true,
						runOptimization: true,
						maxSignals: 5,
					}),
				},
			);

			expect(response.status).toBe(200);
			const body = await jsonOf<{
				driftAlerts: unknown[];
				metrics: { totalRequests: number };
			}>(response);
			expect(Array.isArray(body.driftAlerts)).toBe(true);
			expect(body.metrics.totalRequests).toBeGreaterThan(0);
		} finally {
			if (previousMockEnabled === undefined) {
				delete process.env.MOCK_DISRUPTION_ENABLED;
			} else {
				process.env.MOCK_DISRUPTION_ENABLED = previousMockEnabled;
			}
			resetDisruptionFeedProviderForTests();
		}
	});

	it('keeps dispatch-board SSE updates tenant scoped after the request lifecycle', async () => {
		const app = createApp();
		const tenantAHeaders = {
			authorization: 'Bearer manager:tenant-a-user:tenant-a',
		};
		const tenantBHeaders = {
			authorization: 'Bearer manager:tenant-b-user:tenant-b',
		};

		const disruption = await app.request('/api/field/dispatch/disruptions', {
			method: 'POST',
			headers: tenantAHeaders,
			body: JSON.stringify({
				type: 'technician_unavailable',
				technicianId: 'tech-a1',
				reason: 'stream tenant isolation test',
			}),
		});
		expect(disruption.status).toBe(200);

		const stream = await app.request('/api/field/dispatch-board/stream', {
			headers: tenantAHeaders,
		});
		expect(stream.status).toBe(200);

		const reader = stream.body?.getReader();
		expect(reader).toBeDefined();
		await reader?.read();
		await new Promise((resolve) => setTimeout(resolve, 5_200));
		const secondChunk = await reader?.read();
		const payload = parseSsePayload<{
			board: { availableTechnicians: number };
		}>(new TextDecoder().decode(secondChunk?.value ?? new Uint8Array()));
		expect(payload.board.availableTechnicians).toBe(0);
		await reader?.cancel();

		const tenantBBoard = await app.request('/api/field/dispatch-board', {
			headers: tenantBHeaders,
		});
		expect(tenantBBoard.status).toBe(200);
		const tenantBPayload = await jsonOf<{ availableTechnicians: number }>(
			tenantBBoard,
		);
		expect(tenantBPayload.availableTechnicians).toBe(1);
	}, 15_000);

	it('supports mobile sync batch operations', async () => {
		const app = createApp();

		await app.request('/api/field/jobs/assign', {
			method: 'POST',
			headers: authHeaders,
			body: JSON.stringify({ jobId: 'job-100' }),
		});

		const response = await app.request('/api/field/mobile/sync', {
			method: 'POST',
			headers: authHeaders,
			body: JSON.stringify({
				operations: [
					{
						clientOperationId: 'op-1',
						type: 'start_job',
						payload: { jobId: 'job-100' },
					},
					{
						clientOperationId: 'op-2',
						type: 'update_checklist',
						payload: {
							jobId: 'job-100',
							items: [
								{ id: 'site-safety', done: true },
								{ id: 'verify-asset', done: true },
							],
						},
					},
				],
			}),
		});

		expect(response.status).toBe(200);
		const body = await jsonOf<{ successCount: number; failedCount: number }>(
			response,
		);
		expect(body.successCount).toBeGreaterThan(0);
		expect(body.failedCount).toBe(0);
	});

	it('returns observability metrics snapshot', async () => {
		const app = createApp();

		await app.request('/api/field/dispatch-board', {
			headers: authHeaders,
		});
		await app.request('/api/field/jobs/assign', {
			method: 'POST',
			headers: authHeaders,
			body: JSON.stringify({ jobId: 'job-100' }),
		});

		const response = await app.request(
			'/api/field/observability/metrics?windowMinutes=120',
			{
				headers: authHeaders,
			},
		);
		expect(response.status).toBe(200);
		const body = observabilityMetricsResponseSchema.parse(
			await response.json(),
		);
		expect(body.metrics.totalRequests).toBeGreaterThan(0);
		expect(body.metrics.routes.length).toBeGreaterThan(0);
	});

	it('falls back to heuristics when provider fails', async () => {
		const previousProvider = process.env.FIELD_INTELLIGENCE_PROVIDER;
		const previousBaseUrl = process.env.FIELD_INTELLIGENCE_BASE_URL;
		const previousFetch = globalThis.fetch;

		process.env.FIELD_INTELLIGENCE_PROVIDER = 'http';
		process.env.FIELD_INTELLIGENCE_BASE_URL =
			'https://field-intel.invalid.test';
		globalThis.fetch = vi.fn(async () => {
			throw new Error('provider unavailable');
		}) as unknown as typeof fetch;
		resetFieldIntelligenceProviderForTests();

		try {
			const app = createApp();
			const response = await app.request(
				'/api/field/jobs/job-100/intelligence',
				{
					method: 'POST',
					headers: authHeaders,
					body: JSON.stringify({ symptoms: ['fault'] }),
				},
			);

			expect(response.status).toBe(200);
			expect(response.headers.get('x-intelligence-provider-warning')).toBe(
				'provider-fallback',
			);
		} finally {
			if (previousProvider === undefined) {
				delete process.env.FIELD_INTELLIGENCE_PROVIDER;
			} else {
				process.env.FIELD_INTELLIGENCE_PROVIDER = previousProvider;
			}

			if (previousBaseUrl === undefined) {
				delete process.env.FIELD_INTELLIGENCE_BASE_URL;
			} else {
				process.env.FIELD_INTELLIGENCE_BASE_URL = previousBaseUrl;
			}

			globalThis.fetch = previousFetch;
			resetFieldIntelligenceProviderForTests();
		}
	});

	it('runs assign -> checklist -> complete flow', async () => {
		const app = createApp();

		const assignResponse = await app.request('/api/field/jobs/assign', {
			method: 'POST',
			headers: authHeaders,
			body: JSON.stringify({ jobId: 'job-100' }),
		});
		expect(assignResponse.status).toBe(202);

		const blockedComplete = await app.request(
			'/api/field/jobs/job-100/complete',
			{
				method: 'POST',
				headers: authHeaders,
				body: JSON.stringify({ firstTimeFix: true }),
			},
		);
		expect(blockedComplete.status).toBe(409);
		const blockedBody = await jsonOf<{ code?: string }>(blockedComplete);
		expect(blockedBody.code).toBe(JOB_LIFECYCLE_ERROR_CODES.invalidTransition);

		const checklistUpdate = await app.request(
			'/api/field/jobs/job-100/checklist',
			{
				method: 'POST',
				headers: authHeaders,
				body: JSON.stringify({
					items: [
						{ id: 'site-safety', done: true },
						{ id: 'verify-asset', done: true },
					],
				}),
			},
		);
		expect(checklistUpdate.status).toBe(200);

		const startResponse = await app.request('/api/field/jobs/job-100/start', {
			method: 'POST',
			headers: authHeaders,
			body: JSON.stringify({}),
		});
		expect(startResponse.status).toBe(200);

		const completeResponse = await app.request(
			'/api/field/jobs/job-100/complete',
			{
				method: 'POST',
				headers: authHeaders,
				body: JSON.stringify({
					firstTimeFix: true,
					completionNotes: 'Resolved on first visit',
				}),
			},
		);
		expect(completeResponse.status).toBe(200);
	});

	it('returns CRM customer context', async () => {
		const app = createApp();
		const response = await app.request(
			'/api/field/integrations/crm/customers/cust-101/context',
			{
				headers: authHeaders,
			},
		);

		expect(response.status).toBe(200);

		const body = await jsonOf<{ context: { customerId: string } }>(response);
		expect(body.context.customerId).toBe('cust-101');
	});

	it('creates invoice from completed job and fetches it', async () => {
		const app = createApp();

		const blocked = await app.request(
			'/api/field/integrations/invoicing/jobs/job-100/invoice',
			{
				method: 'POST',
				headers: authHeaders,
				body: JSON.stringify({}),
			},
		);
		expect(blocked.status).toBe(409);

		await app.request('/api/field/jobs/assign', {
			method: 'POST',
			headers: authHeaders,
			body: JSON.stringify({ jobId: 'job-100' }),
		});
		await app.request('/api/field/jobs/job-100/checklist', {
			method: 'POST',
			headers: authHeaders,
			body: JSON.stringify({
				items: [
					{ id: 'site-safety', done: true },
					{ id: 'verify-asset', done: true },
				],
			}),
		});
		await app.request('/api/field/jobs/job-100/start', {
			method: 'POST',
			headers: authHeaders,
			body: JSON.stringify({}),
		});
		await app.request('/api/field/jobs/job-100/complete', {
			method: 'POST',
			headers: authHeaders,
			body: JSON.stringify({ firstTimeFix: true }),
		});

		const createInvoice = await app.request(
			'/api/field/integrations/invoicing/jobs/job-100/invoice',
			{
				method: 'POST',
				headers: authHeaders,
				body: JSON.stringify({ taxRatePercent: 8 }),
			},
		);

		expect(createInvoice.status).toBe(201);

		const createdBody = await jsonOf<{ ok: true; invoice: { id: string } }>(
			createInvoice,
		);
		const invoiceId = createdBody.invoice.id;

		const invoiceResponse = await app.request(
			`/api/field/integrations/invoicing/invoices/${invoiceId}`,
			{
				headers: authHeaders,
			},
		);
		expect(invoiceResponse.status).toBe(200);

		const listResponse = await app.request(
			'/api/field/integrations/invoicing/invoices',
			{
				headers: authHeaders,
			},
		);
		expect(listResponse.status).toBe(200);
	});

	it('returns integration outbox summary and entries', async () => {
		const app = createApp();

		await app.request('/api/field/jobs/assign', {
			method: 'POST',
			headers: authHeaders,
			body: JSON.stringify({ jobId: 'job-100' }),
		});

		const response = await app.request(
			'/api/field/integrations/outbox?limit=20',
			{
				headers: authHeaders,
			},
		);

		expect(response.status).toBe(200);
		const body = integrationOutboxListResponseSchema.parse(
			await response.json(),
		);
		expect(body.summary.total).toBeGreaterThan(0);
		expect(body.entries.length).toBeGreaterThan(0);
		expect(body.entries[0]?.type).toBe('crm_work_order_event');
	});

	it('requeues dead-letter outbox entries for retry', async () => {
		const previousCrmProvider = process.env.CRM_PROVIDER;
		const previousCrmBaseUrl = process.env.CRM_BASE_URL;
		const previousMaxAttempts = process.env.INTEGRATION_OUTBOX_MAX_ATTEMPTS;
		const previousFetch = globalThis.fetch;

		process.env.CRM_PROVIDER = 'http';
		process.env.CRM_BASE_URL = 'https://crm.invalid.test';
		process.env.INTEGRATION_OUTBOX_MAX_ATTEMPTS = '1';
		globalThis.fetch = vi.fn(async () => {
			throw new Error('crm unavailable');
		}) as unknown as typeof fetch;
		await resetIntegrationStateForTests();

		try {
			const app = createApp();

			const assign = await app.request('/api/field/jobs/assign', {
				method: 'POST',
				headers: authHeaders,
				body: JSON.stringify({ jobId: 'job-100' }),
			});
			expect(assign.status).toBe(202);

			const flush = await app.request('/api/field/integrations/outbox/flush', {
				method: 'POST',
				headers: authHeaders,
				body: JSON.stringify({
					maxBatch: 10,
				}),
			});
			expect(flush.status).toBe(200);

			const requeue = await app.request(
				'/api/field/integrations/outbox/requeue',
				{
					method: 'POST',
					headers: authHeaders,
					body: JSON.stringify({
						limit: 10,
					}),
				},
			);
			expect(requeue.status).toBe(200);
			const requeueBody = await jsonOf<{
				result: { requeued: number };
				summary: { pending: number };
			}>(requeue);
			expect(requeueBody.result.requeued).toBeGreaterThan(0);
			expect(requeueBody.summary.pending).toBeGreaterThan(0);
		} finally {
			if (previousCrmProvider === undefined) {
				delete process.env.CRM_PROVIDER;
			} else {
				process.env.CRM_PROVIDER = previousCrmProvider;
			}

			if (previousCrmBaseUrl === undefined) {
				delete process.env.CRM_BASE_URL;
			} else {
				process.env.CRM_BASE_URL = previousCrmBaseUrl;
			}

			if (previousMaxAttempts === undefined) {
				delete process.env.INTEGRATION_OUTBOX_MAX_ATTEMPTS;
			} else {
				process.env.INTEGRATION_OUTBOX_MAX_ATTEMPTS = previousMaxAttempts;
			}

			globalThis.fetch = previousFetch;
			await resetIntegrationStateForTests();
		}
	});

	it('replays idempotent mutation responses', async () => {
		const app = createApp();
		const requestBody = { jobId: 'job-102' };

		const first = await app.request('/api/field/jobs/assign', {
			method: 'POST',
			headers: {
				...authHeaders,
				'idempotency-key': 'idem-assign-1',
			},
			body: JSON.stringify(requestBody),
		});

		const second = await app.request('/api/field/jobs/assign', {
			method: 'POST',
			headers: {
				...authHeaders,
				'idempotency-key': 'idem-assign-1',
			},
			body: JSON.stringify(requestBody),
		});

		expect(first.status).toBe(202);
		expect(second.status).toBe(202);
		expect(second.headers.get('x-idempotent-replay')).toBe('true');

		const firstBody = await jsonOf<{ assignmentId: string }>(first);
		const secondBody = await jsonOf<{ assignmentId: string }>(second);
		expect(firstBody.assignmentId).toBe(secondBody.assignmentId);
	});

	it('scopes idempotency replay by tenant', async () => {
		const app = createApp();
		const requestBody = { start: '08:00', end: '16:00' };

		const first = await app.request('/api/field/technicians/tech-a1/shifts', {
			method: 'POST',
			headers: {
				authorization: 'Bearer manager:integration-test:tenant-a',
				'idempotency-key': 'idem-shift-tenant',
			},
			body: JSON.stringify(requestBody),
		});
		expect(first.status).toBe(200);

		const replay = await app.request('/api/field/technicians/tech-a1/shifts', {
			method: 'POST',
			headers: {
				authorization: 'Bearer manager:integration-test:tenant-a',
				'idempotency-key': 'idem-shift-tenant',
			},
			body: JSON.stringify(requestBody),
		});
		expect(replay.status).toBe(200);
		expect(replay.headers.get('x-idempotent-replay')).toBe('true');

		const differentTenant = await app.request(
			'/api/field/technicians/tech-a1/shifts',
			{
				method: 'POST',
				headers: {
					authorization: 'Bearer manager:integration-test:tenant-b',
					'idempotency-key': 'idem-shift-tenant',
				},
				body: JSON.stringify(requestBody),
			},
		);
		expect(differentTenant.status).toBe(200);
		expect(differentTenant.headers.get('x-idempotent-replay')).toBeNull();
	});

	it('isolates dispatch state across tenants', async () => {
		const app = createApp();
		const tenantAHeaders = {
			authorization: 'Bearer manager:integration-test:tenant-a',
		};
		const tenantBHeaders = {
			authorization: 'Bearer manager:integration-test:tenant-b',
		};

		await app.request('/api/field/technicians/tech-a1/shifts', {
			method: 'POST',
			headers: tenantAHeaders,
			body: JSON.stringify({ start: '00:00', end: '23:59' }),
		});

		const assignTenantA = await app.request('/api/field/jobs/assign', {
			method: 'POST',
			headers: tenantAHeaders,
			body: JSON.stringify({ jobId: 'job-100' }),
		});
		expect(assignTenantA.status).toBe(202);

		const tenantABoardResponse = await app.request(
			'/api/field/dispatch-board',
			{
				headers: tenantAHeaders,
			},
		);
		const tenantBBoardResponse = await app.request(
			'/api/field/dispatch-board',
			{
				headers: tenantBHeaders,
			},
		);

		expect(tenantABoardResponse.status).toBe(200);
		expect(tenantBBoardResponse.status).toBe(200);

		const tenantABoard = await jsonOf<{
			jobs: Array<{ id: string; status: string; technicianId: string | null }>;
		}>(tenantABoardResponse);
		const tenantBBoard = await jsonOf<{
			jobs: Array<{ id: string; status: string; technicianId: string | null }>;
		}>(tenantBBoardResponse);

		const tenantAJob = tenantABoard.jobs.find((job) => job.id === 'job-100');
		const tenantBJob = tenantBBoard.jobs.find((job) => job.id === 'job-100');

		expect(tenantAJob?.status).toBe('assigned');
		expect(tenantAJob?.technicianId).toBeTypeOf('string');
		expect(tenantBJob?.status).toBe('open');
		expect(tenantBJob?.technicianId).toBeNull();
	});

	it('rejects stale optimistic version on assignment', async () => {
		const app = createApp();

		const first = await app.request('/api/field/jobs/assign', {
			method: 'POST',
			headers: authHeaders,
			body: JSON.stringify({ jobId: 'job-100', expectedVersion: 1 }),
		});
		expect(first.status).toBe(202);

		const stale = await app.request('/api/field/jobs/assign', {
			method: 'POST',
			headers: authHeaders,
			body: JSON.stringify({ jobId: 'job-100', expectedVersion: 1 }),
		});
		expect(stale.status).toBe(409);

		const staleBody = await jsonOf<{ conflict?: boolean }>(stale);
		expect(staleBody.conflict).toBe(true);
		expect((staleBody as { code?: string }).code).toBe(
			JOB_LIFECYCLE_ERROR_CODES.versionConflict,
		);
	});

	it('requires job start before completion and supports start transition', async () => {
		const app = createApp();

		await app.request('/api/field/jobs/assign', {
			method: 'POST',
			headers: authHeaders,
			body: JSON.stringify({ jobId: 'job-100' }),
		});

		await app.request('/api/field/jobs/job-100/checklist', {
			method: 'POST',
			headers: authHeaders,
			body: JSON.stringify({
				items: [
					{ id: 'site-safety', done: true },
					{ id: 'verify-asset', done: true },
				],
			}),
		});

		const blockedComplete = await app.request(
			'/api/field/jobs/job-100/complete',
			{
				method: 'POST',
				headers: authHeaders,
				body: JSON.stringify({ firstTimeFix: true }),
			},
		);
		expect(blockedComplete.status).toBe(409);
		const blockedBody = await jsonOf<{ code?: string }>(blockedComplete);
		expect(blockedBody.code).toBe(JOB_LIFECYCLE_ERROR_CODES.invalidTransition);

		const start = await app.request('/api/field/jobs/job-100/start', {
			method: 'POST',
			headers: authHeaders,
			body: JSON.stringify({}),
		});
		expect(start.status).toBe(200);

		const complete = await app.request('/api/field/jobs/job-100/complete', {
			method: 'POST',
			headers: authHeaders,
			body: JSON.stringify({ firstTimeFix: true }),
		});
		expect(complete.status).toBe(200);
	});

	it('prevents reassign and unassign once job is in progress', async () => {
		const app = createApp();

		await app.request('/api/field/jobs/assign', {
			method: 'POST',
			headers: authHeaders,
			body: JSON.stringify({ jobId: 'job-100' }),
		});

		await app.request('/api/field/jobs/job-100/start', {
			method: 'POST',
			headers: authHeaders,
			body: JSON.stringify({}),
		});

		const reassign = await app.request('/api/field/jobs/reassign', {
			method: 'POST',
			headers: authHeaders,
			body: JSON.stringify({ jobId: 'job-100', toTechnicianId: 'tech-b2' }),
		});
		expect(reassign.status).toBe(409);
		const reassignBody = await jsonOf<{ code?: string }>(reassign);
		expect(reassignBody.code).toBe(JOB_LIFECYCLE_ERROR_CODES.invalidTransition);

		const unassign = await app.request('/api/field/jobs/unassign', {
			method: 'POST',
			headers: authHeaders,
			body: JSON.stringify({ jobId: 'job-100' }),
		});
		expect(unassign.status).toBe(409);
		const unassignBody = await jsonOf<{ code?: string }>(unassign);
		expect(unassignBody.code).toBe(JOB_LIFECYCLE_ERROR_CODES.invalidTransition);
	});

	it('records job status transition audit entries on start', async () => {
		const app = createApp();

		await app.request('/api/field/jobs/assign', {
			method: 'POST',
			headers: authHeaders,
			body: JSON.stringify({ jobId: 'job-100' }),
		});

		const start = await app.request('/api/field/jobs/job-100/start', {
			method: 'POST',
			headers: authHeaders,
			body: JSON.stringify({}),
		});
		expect(start.status).toBe(200);

		const audit = await app.request('/api/field/audit-trail?limit=10', {
			headers: authHeaders,
		});
		expect(audit.status).toBe(200);

		const auditBody = await jsonOf<{ entries: Array<{ type: string }> }>(audit);
		expect(
			auditBody.entries.some((entry) => entry.type === 'job_status_transition'),
		).toBe(true);
	});

	it('returns 429 when mutation rate limit is exceeded', async () => {
		const previousRateLimitEnabled = process.env.RATE_LIMIT_ENABLED;
		const previousMutationLimit = process.env.RATE_LIMIT_MUTATION_LIMIT;
		const previousWindowMs = process.env.RATE_LIMIT_WINDOW_MS;

		process.env.RATE_LIMIT_ENABLED = 'true';
		process.env.RATE_LIMIT_MUTATION_LIMIT = '1';
		process.env.RATE_LIMIT_WINDOW_MS = '60000';
		resetRateLimiterForTests();

		try {
			const app = createApp();

			const first = await app.request('/api/field/jobs/assign', {
				method: 'POST',
				headers: authHeaders,
				body: JSON.stringify({ jobId: 'job-100' }),
			});
			expect(first.status).toBe(202);

			const second = await app.request('/api/field/jobs/assign', {
				method: 'POST',
				headers: authHeaders,
				body: JSON.stringify({ jobId: 'job-102' }),
			});
			expect(second.status).toBe(429);

			const body = await jsonOf<{ bucket?: string }>(second);
			expect(body.bucket).toBe('mutation');
		} finally {
			if (previousRateLimitEnabled === undefined) {
				delete process.env.RATE_LIMIT_ENABLED;
			} else {
				process.env.RATE_LIMIT_ENABLED = previousRateLimitEnabled;
			}

			if (previousMutationLimit === undefined) {
				delete process.env.RATE_LIMIT_MUTATION_LIMIT;
			} else {
				process.env.RATE_LIMIT_MUTATION_LIMIT = previousMutationLimit;
			}

			if (previousWindowMs === undefined) {
				delete process.env.RATE_LIMIT_WINDOW_MS;
			} else {
				process.env.RATE_LIMIT_WINDOW_MS = previousWindowMs;
			}

			resetRateLimiterForTests();
		}
	});

	it('applies mutation limits independently per tenant', async () => {
		const previousRateLimitEnabled = process.env.RATE_LIMIT_ENABLED;
		const previousMutationLimit = process.env.RATE_LIMIT_MUTATION_LIMIT;
		const previousWindowMs = process.env.RATE_LIMIT_WINDOW_MS;

		process.env.RATE_LIMIT_ENABLED = 'true';
		process.env.RATE_LIMIT_MUTATION_LIMIT = '1';
		process.env.RATE_LIMIT_WINDOW_MS = '60000';
		resetRateLimiterForTests();

		try {
			const app = createApp();

			await app.request('/api/field/technicians/tech-a1/shifts', {
				method: 'POST',
				headers: {
					authorization: 'Bearer manager:integration-test:tenant-a',
				},
				body: JSON.stringify({ start: '00:00', end: '23:59' }),
			});
			await app.request('/api/field/technicians/tech-a1/shifts', {
				method: 'POST',
				headers: {
					authorization: 'Bearer manager:integration-test:tenant-b',
				},
				body: JSON.stringify({ start: '00:00', end: '23:59' }),
			});

			const tenantAFirst = await app.request('/api/field/jobs/assign', {
				method: 'POST',
				headers: {
					authorization: 'Bearer manager:integration-test:tenant-a',
				},
				body: JSON.stringify({ jobId: 'job-100' }),
			});
			expect(tenantAFirst.status).toBe(202);

			const tenantBFirst = await app.request('/api/field/jobs/assign', {
				method: 'POST',
				headers: {
					authorization: 'Bearer manager:integration-test:tenant-b',
				},
				body: JSON.stringify({ jobId: 'job-102' }),
			});
			expect(tenantBFirst.status).toBe(202);
		} finally {
			if (previousRateLimitEnabled === undefined) {
				delete process.env.RATE_LIMIT_ENABLED;
			} else {
				process.env.RATE_LIMIT_ENABLED = previousRateLimitEnabled;
			}

			if (previousMutationLimit === undefined) {
				delete process.env.RATE_LIMIT_MUTATION_LIMIT;
			} else {
				process.env.RATE_LIMIT_MUTATION_LIMIT = previousMutationLimit;
			}

			if (previousWindowMs === undefined) {
				delete process.env.RATE_LIMIT_WINDOW_MS;
			} else {
				process.env.RATE_LIMIT_WINDOW_MS = previousWindowMs;
			}

			resetRateLimiterForTests();
		}
	});

	it('applies integration bucket limit independently', async () => {
		const previousRateLimitEnabled = process.env.RATE_LIMIT_ENABLED;
		const previousIntegrationLimit = process.env.RATE_LIMIT_INTEGRATION_LIMIT;
		const previousWindowMs = process.env.RATE_LIMIT_WINDOW_MS;

		process.env.RATE_LIMIT_ENABLED = 'true';
		process.env.RATE_LIMIT_INTEGRATION_LIMIT = '1';
		process.env.RATE_LIMIT_WINDOW_MS = '60000';
		resetRateLimiterForTests();

		try {
			const app = createApp();

			const first = await app.request(
				'/api/field/integrations/invoicing/invoices',
				{
					headers: authHeaders,
				},
			);
			expect(first.status).toBe(200);

			const second = await app.request(
				'/api/field/integrations/invoicing/invoices',
				{
					headers: authHeaders,
				},
			);
			expect(second.status).toBe(429);

			const body = await jsonOf<{ bucket?: string }>(second);
			expect(body.bucket).toBe('integration');
		} finally {
			if (previousRateLimitEnabled === undefined) {
				delete process.env.RATE_LIMIT_ENABLED;
			} else {
				process.env.RATE_LIMIT_ENABLED = previousRateLimitEnabled;
			}

			if (previousIntegrationLimit === undefined) {
				delete process.env.RATE_LIMIT_INTEGRATION_LIMIT;
			} else {
				process.env.RATE_LIMIT_INTEGRATION_LIMIT = previousIntegrationLimit;
			}

			if (previousWindowMs === undefined) {
				delete process.env.RATE_LIMIT_WINDOW_MS;
			} else {
				process.env.RATE_LIMIT_WINDOW_MS = previousWindowMs;
			}

			resetRateLimiterForTests();
		}
	});

	it('uses admin-specific mutation limit override', async () => {
		const previousRateLimitEnabled = process.env.RATE_LIMIT_ENABLED;
		const previousMutationLimit = process.env.RATE_LIMIT_MUTATION_LIMIT;
		const previousAdminMutationLimit =
			process.env.RATE_LIMIT_ADMIN_MUTATION_LIMIT;
		const previousWindowMs = process.env.RATE_LIMIT_WINDOW_MS;

		process.env.RATE_LIMIT_ENABLED = 'true';
		process.env.RATE_LIMIT_MUTATION_LIMIT = '1';
		process.env.RATE_LIMIT_ADMIN_MUTATION_LIMIT = '3';
		process.env.RATE_LIMIT_WINDOW_MS = '60000';
		resetRateLimiterForTests();

		try {
			const app = createApp();
			const adminHeaders = {
				authorization: 'Bearer admin:ops-admin',
			};

			const first = await app.request('/api/field/jobs/assign', {
				method: 'POST',
				headers: adminHeaders,
				body: JSON.stringify({ jobId: 'job-100' }),
			});
			expect(first.status).toBe(202);

			const second = await app.request('/api/field/jobs/assign', {
				method: 'POST',
				headers: adminHeaders,
				body: JSON.stringify({ jobId: 'job-102' }),
			});
			expect(second.status).toBe(202);
		} finally {
			if (previousRateLimitEnabled === undefined) {
				delete process.env.RATE_LIMIT_ENABLED;
			} else {
				process.env.RATE_LIMIT_ENABLED = previousRateLimitEnabled;
			}

			if (previousMutationLimit === undefined) {
				delete process.env.RATE_LIMIT_MUTATION_LIMIT;
			} else {
				process.env.RATE_LIMIT_MUTATION_LIMIT = previousMutationLimit;
			}

			if (previousAdminMutationLimit === undefined) {
				delete process.env.RATE_LIMIT_ADMIN_MUTATION_LIMIT;
			} else {
				process.env.RATE_LIMIT_ADMIN_MUTATION_LIMIT =
					previousAdminMutationLimit;
			}

			if (previousWindowMs === undefined) {
				delete process.env.RATE_LIMIT_WINDOW_MS;
			} else {
				process.env.RATE_LIMIT_WINDOW_MS = previousWindowMs;
			}

			resetRateLimiterForTests();
		}
	});

	it('bypasses throttling for configured subjects', async () => {
		const previousRateLimitEnabled = process.env.RATE_LIMIT_ENABLED;
		const previousMutationLimit = process.env.RATE_LIMIT_MUTATION_LIMIT;
		const previousBypassSubjects = process.env.RATE_LIMIT_BYPASS_SUBJECTS;
		const previousWindowMs = process.env.RATE_LIMIT_WINDOW_MS;

		process.env.RATE_LIMIT_ENABLED = 'true';
		process.env.RATE_LIMIT_MUTATION_LIMIT = '1';
		process.env.RATE_LIMIT_BYPASS_SUBJECTS = 'manager:integration-test';
		process.env.RATE_LIMIT_WINDOW_MS = '60000';
		resetRateLimiterForTests();

		try {
			const app = createApp();

			const first = await app.request('/api/field/jobs/assign', {
				method: 'POST',
				headers: authHeaders,
				body: JSON.stringify({ jobId: 'job-100' }),
			});
			expect(first.status).toBe(202);
			expect(first.headers.get('x-ratelimit-bypass')).toBe('true');

			const second = await app.request('/api/field/jobs/assign', {
				method: 'POST',
				headers: authHeaders,
				body: JSON.stringify({ jobId: 'job-102' }),
			});
			expect(second.status).toBe(202);
			expect(second.headers.get('x-ratelimit-bypass')).toBe('true');
		} finally {
			if (previousRateLimitEnabled === undefined) {
				delete process.env.RATE_LIMIT_ENABLED;
			} else {
				process.env.RATE_LIMIT_ENABLED = previousRateLimitEnabled;
			}

			if (previousMutationLimit === undefined) {
				delete process.env.RATE_LIMIT_MUTATION_LIMIT;
			} else {
				process.env.RATE_LIMIT_MUTATION_LIMIT = previousMutationLimit;
			}

			if (previousBypassSubjects === undefined) {
				delete process.env.RATE_LIMIT_BYPASS_SUBJECTS;
			} else {
				process.env.RATE_LIMIT_BYPASS_SUBJECTS = previousBypassSubjects;
			}

			if (previousWindowMs === undefined) {
				delete process.env.RATE_LIMIT_WINDOW_MS;
			} else {
				process.env.RATE_LIMIT_WINDOW_MS = previousWindowMs;
			}

			resetRateLimiterForTests();
		}
	});

	it('keeps assignment successful and queues CRM sync in outbox when provider is unavailable', async () => {
		const previousCrmProvider = process.env.CRM_PROVIDER;
		const previousCrmBaseUrl = process.env.CRM_BASE_URL;
		const previousFetch = globalThis.fetch;

		process.env.CRM_PROVIDER = 'http';
		process.env.CRM_BASE_URL = 'https://crm.invalid.test';
		globalThis.fetch = vi.fn(async () => {
			throw new Error('crm unavailable');
		}) as unknown as typeof fetch;
		await resetIntegrationStateForTests();

		try {
			const app = createApp();
			const response = await app.request('/api/field/jobs/assign', {
				method: 'POST',
				headers: authHeaders,
				body: JSON.stringify({ jobId: 'job-100' }),
			});

			expect(response.status).toBe(202);
			expect(response.headers.get('x-integration-outbox')).toBeTruthy();

			const flush = await app.request('/api/field/integrations/outbox/flush', {
				method: 'POST',
				headers: authHeaders,
				body: JSON.stringify({
					maxBatch: 10,
				}),
			});
			expect(flush.status).toBe(200);
			const flushBody = integrationOutboxFlushResponseSchema.parse(
				await flush.json(),
			);
			expect(flushBody.result.processed).toBeGreaterThan(0);
			expect(flushBody.result.failed).toBeGreaterThan(0);
		} finally {
			if (previousCrmProvider === undefined) {
				delete process.env.CRM_PROVIDER;
			} else {
				process.env.CRM_PROVIDER = previousCrmProvider;
			}

			if (previousCrmBaseUrl === undefined) {
				delete process.env.CRM_BASE_URL;
			} else {
				process.env.CRM_BASE_URL = previousCrmBaseUrl;
			}

			globalThis.fetch = previousFetch;
			await resetIntegrationStateForTests();
		}
	});

	it('returns 502 when CRM context provider is unavailable', async () => {
		const previousCrmProvider = process.env.CRM_PROVIDER;
		const previousCrmBaseUrl = process.env.CRM_BASE_URL;
		const previousFetch = globalThis.fetch;

		process.env.CRM_PROVIDER = 'http';
		process.env.CRM_BASE_URL = 'https://crm.invalid.test';
		globalThis.fetch = vi.fn(async () => {
			throw new Error('crm unavailable');
		}) as unknown as typeof fetch;
		await resetIntegrationStateForTests();

		try {
			const app = createApp();
			const response = await app.request(
				'/api/field/integrations/crm/customers/cust-101/context',
				{
					headers: authHeaders,
				},
			);

			expect(response.status).toBe(502);
			const body = await jsonOf<{ integration: string }>(response);
			expect(body.integration).toBe('crm');
		} finally {
			if (previousCrmProvider === undefined) {
				delete process.env.CRM_PROVIDER;
			} else {
				process.env.CRM_PROVIDER = previousCrmProvider;
			}

			if (previousCrmBaseUrl === undefined) {
				delete process.env.CRM_BASE_URL;
			} else {
				process.env.CRM_BASE_URL = previousCrmBaseUrl;
			}

			globalThis.fetch = previousFetch;
			await resetIntegrationStateForTests();
		}
	});

	it('retries transient CRM 5xx responses before succeeding', async () => {
		const previousCrmProvider = process.env.CRM_PROVIDER;
		const previousCrmBaseUrl = process.env.CRM_BASE_URL;
		const previousRetries = process.env.INTEGRATION_HTTP_RETRIES;
		const previousRetryBase = process.env.INTEGRATION_HTTP_RETRY_BASE_MS;
		const previousFetch = globalThis.fetch;
		let attempts = 0;

		process.env.CRM_PROVIDER = 'http';
		process.env.CRM_BASE_URL = 'https://crm.retry.test';
		process.env.INTEGRATION_HTTP_RETRIES = '2';
		process.env.INTEGRATION_HTTP_RETRY_BASE_MS = '0';
		globalThis.fetch = vi.fn(async () => {
			attempts += 1;

			if (attempts < 2) {
				return new Response('upstream failure', { status: 500 });
			}

			return new Response(
				JSON.stringify({
					customerId: 'cust-101',
					customerName: 'Retry Customer',
					tier: 'priority',
					openServiceCount: 1,
					lastServiceAt: new Date().toISOString(),
					notes: ['retry-success'],
				}),
				{
					status: 200,
					headers: { 'content-type': 'application/json' },
				},
			);
		}) as unknown as typeof fetch;
		await resetIntegrationStateForTests();

		try {
			const app = createApp();
			const response = await app.request(
				'/api/field/integrations/crm/customers/cust-101/context',
				{
					headers: authHeaders,
				},
			);

			expect(response.status).toBe(200);
			const body = await jsonOf<{ context: { customerId: string } }>(response);
			expect(body.context.customerId).toBe('cust-101');
			expect(attempts).toBe(2);
		} finally {
			if (previousCrmProvider === undefined) {
				delete process.env.CRM_PROVIDER;
			} else {
				process.env.CRM_PROVIDER = previousCrmProvider;
			}

			if (previousCrmBaseUrl === undefined) {
				delete process.env.CRM_BASE_URL;
			} else {
				process.env.CRM_BASE_URL = previousCrmBaseUrl;
			}

			if (previousRetries === undefined) {
				delete process.env.INTEGRATION_HTTP_RETRIES;
			} else {
				process.env.INTEGRATION_HTTP_RETRIES = previousRetries;
			}

			if (previousRetryBase === undefined) {
				delete process.env.INTEGRATION_HTTP_RETRY_BASE_MS;
			} else {
				process.env.INTEGRATION_HTTP_RETRY_BASE_MS = previousRetryBase;
			}

			globalThis.fetch = previousFetch;
			await resetIntegrationStateForTests();
		}
	});

	it('opens CRM circuit after repeated failures and short-circuits extra requests', async () => {
		const previousCrmProvider = process.env.CRM_PROVIDER;
		const previousCrmBaseUrl = process.env.CRM_BASE_URL;
		const previousRetries = process.env.INTEGRATION_HTTP_RETRIES;
		const previousThreshold =
			process.env.INTEGRATION_HTTP_CIRCUIT_FAILURE_THRESHOLD;
		const previousCooldown = process.env.INTEGRATION_HTTP_CIRCUIT_COOLDOWN_MS;
		const previousRetryBase = process.env.INTEGRATION_HTTP_RETRY_BASE_MS;
		const previousFetch = globalThis.fetch;
		let attempts = 0;

		process.env.CRM_PROVIDER = 'http';
		process.env.CRM_BASE_URL = 'https://crm.circuit.test';
		process.env.INTEGRATION_HTTP_RETRIES = '0';
		process.env.INTEGRATION_HTTP_RETRY_BASE_MS = '0';
		process.env.INTEGRATION_HTTP_CIRCUIT_FAILURE_THRESHOLD = '2';
		process.env.INTEGRATION_HTTP_CIRCUIT_COOLDOWN_MS = '120000';
		globalThis.fetch = vi.fn(async () => {
			attempts += 1;
			throw new Error('crm circuit failure');
		}) as unknown as typeof fetch;
		await resetIntegrationStateForTests();

		try {
			const app = createApp();
			const first = await app.request(
				'/api/field/integrations/crm/customers/cust-101/context',
				{
					headers: authHeaders,
				},
			);
			const second = await app.request(
				'/api/field/integrations/crm/customers/cust-101/context',
				{
					headers: authHeaders,
				},
			);
			const third = await app.request(
				'/api/field/integrations/crm/customers/cust-101/context',
				{
					headers: authHeaders,
				},
			);

			expect(first.status).toBe(502);
			expect(second.status).toBe(502);
			expect(third.status).toBe(502);
			expect(attempts).toBe(2);
		} finally {
			if (previousCrmProvider === undefined) {
				delete process.env.CRM_PROVIDER;
			} else {
				process.env.CRM_PROVIDER = previousCrmProvider;
			}

			if (previousCrmBaseUrl === undefined) {
				delete process.env.CRM_BASE_URL;
			} else {
				process.env.CRM_BASE_URL = previousCrmBaseUrl;
			}

			if (previousRetries === undefined) {
				delete process.env.INTEGRATION_HTTP_RETRIES;
			} else {
				process.env.INTEGRATION_HTTP_RETRIES = previousRetries;
			}

			if (previousThreshold === undefined) {
				delete process.env.INTEGRATION_HTTP_CIRCUIT_FAILURE_THRESHOLD;
			} else {
				process.env.INTEGRATION_HTTP_CIRCUIT_FAILURE_THRESHOLD =
					previousThreshold;
			}

			if (previousCooldown === undefined) {
				delete process.env.INTEGRATION_HTTP_CIRCUIT_COOLDOWN_MS;
			} else {
				process.env.INTEGRATION_HTTP_CIRCUIT_COOLDOWN_MS = previousCooldown;
			}

			if (previousRetryBase === undefined) {
				delete process.env.INTEGRATION_HTTP_RETRY_BASE_MS;
			} else {
				process.env.INTEGRATION_HTTP_RETRY_BASE_MS = previousRetryBase;
			}

			globalThis.fetch = previousFetch;
			await resetIntegrationStateForTests();
		}
	});
});
