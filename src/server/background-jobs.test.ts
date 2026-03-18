import { afterEach, describe, expect, it } from 'vitest';
import {
	type BackgroundJob,
	type BackgroundJobStore,
	configureBackgroundJobStore,
	enqueueBackgroundJob,
	getBackgroundJob,
	resetBackgroundJobsForTests,
} from './background-jobs';

function createBackgroundJobStore(seed: BackgroundJob[]): BackgroundJobStore {
	let jobs = [...seed];

	return {
		async enqueue(job) {
			jobs.unshift(job);
		},
		async claimNext(input) {
			const staleBeforeMs = Date.parse(input.nowIso) - input.runningTimeoutMs;
			const candidate = jobs
				.filter((job) => {
					if (job.status === 'queued') {
						return true;
					}

					return (
						job.status === 'running' &&
						job.startedAt !== null &&
						Date.parse(job.startedAt) <= staleBeforeMs
					);
				})
				.sort((a, b) => Date.parse(a.queuedAt) - Date.parse(b.queuedAt))[0];

			if (!candidate) {
				return null;
			}

			const claimed: BackgroundJob = {
				...candidate,
				status: 'running',
				startedAt: input.nowIso,
				finishedAt: null,
				error: null,
			};
			jobs = jobs.map((job) => (job.id === claimed.id ? claimed : job));
			return claimed;
		},
		async update(job) {
			jobs = jobs.map((existing) => (existing.id === job.id ? job : existing));
		},
		async getById(jobId, tenantId) {
			return (
				jobs.find(
					(job) =>
						job.id === jobId && (tenantId ? job.tenantId === tenantId : true),
				) ?? null
			);
		},
		async list(limit, tenantId) {
			return jobs
				.filter((job) => (tenantId ? job.tenantId === tenantId : true))
				.slice(0, limit);
		},
		async resetForTests() {
			jobs = [];
		},
	};
}

async function waitForJob(jobId: string, tenantId: string) {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		const job = await getBackgroundJob(jobId, tenantId);
		if (job?.status === 'completed') {
			return job;
		}

		await new Promise((resolve) => setTimeout(resolve, 10));
	}

	return getBackgroundJob(jobId, tenantId);
}

describe('background job runtime', () => {
	afterEach(async () => {
		delete process.env.BACKGROUND_JOB_RUNNING_TIMEOUT_MS;
		await resetBackgroundJobsForTests();
	});

	it('reclaims stale running jobs and completes them', async () => {
		process.env.BACKGROUND_JOB_RUNNING_TIMEOUT_MS = '1000';
		configureBackgroundJobStore(
			createBackgroundJobStore([
				{
					id: 'job-stale',
					type: 'integration_outbox_flush',
					tenantId: 'tenant-a',
					status: 'running',
					payload: {
						maxBatch: 1,
					},
					result: null,
					error: null,
					queuedAt: '2026-03-08T00:00:00.000Z',
					startedAt: '2026-03-08T00:00:01.000Z',
					finishedAt: null,
				},
			]),
		);

		await enqueueBackgroundJob({
			type: 'integration_outbox_flush',
			tenantId: 'tenant-a',
			payload: {
				maxBatch: 1,
			},
		});

		const staleJob = await waitForJob('job-stale', 'tenant-a');
		expect(staleJob?.status).toBe('completed');
		expect(staleJob?.finishedAt).toBeTruthy();
	});
});
