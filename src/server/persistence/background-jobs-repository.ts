import { and, eq, sql } from 'drizzle-orm';
import { backgroundJobs } from '../../../drizzle/schema';
import type { BackgroundJob, BackgroundJobStore } from '../background-jobs';
import { withDbSpan } from './db-tracing';

type DrizzleDb = {
	select?: (...args: unknown[]) => {
		from: (table: unknown) => {
			where: (filter: unknown) => Promise<Array<Record<string, unknown>>>;
		};
	};
	insert: (table: unknown) => {
		values: (value: unknown) => {
			execute?: () => Promise<unknown>;
		};
	};
	update?: (table: unknown) => {
		set: (value: unknown) => {
			where: (filter: unknown) => Promise<unknown>;
		};
	};
	delete: (table: unknown) => {
		where: (filter: unknown) => Promise<unknown>;
	};
	execute?: (
		query: unknown,
	) => Promise<
		{ rows?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>
	>;
};

function toBackgroundJob(row: Record<string, unknown>): BackgroundJob {
	return {
		id: String(row.id),
		tenantId: String(row.tenantId ?? row.tenant_id ?? 'default'),
		type: String(row.type) as BackgroundJob['type'],
		status: String(row.status) as BackgroundJob['status'],
		payload: (row.payload ?? {}) as Record<string, unknown>,
		result: (row.result ?? null) as unknown,
		error: (row.error ?? null) as string | null,
		queuedAt: String(row.queuedAt ?? row.queued_at ?? new Date().toISOString()),
		startedAt: (row.startedAt ?? row.started_at ?? null) as string | null,
		finishedAt: (row.finishedAt ?? row.finished_at ?? null) as string | null,
	};
}

function _byOldestQueued(a: BackgroundJob, b: BackgroundJob) {
	return Date.parse(a.queuedAt) - Date.parse(b.queuedAt);
}

function byNewestQueued(a: BackgroundJob, b: BackgroundJob) {
	return Date.parse(b.queuedAt) - Date.parse(a.queuedAt);
}

function rowsFromExecuteResult(
	result:
		| { rows?: Array<Record<string, unknown>> }
		| Array<Record<string, unknown>>,
) {
	return Array.isArray(result) ? result : (result.rows ?? []);
}

export class DrizzleBackgroundJobsRepository implements BackgroundJobStore {
	constructor(private readonly db: DrizzleDb) {}

	async enqueue(job: BackgroundJob) {
		await withDbSpan(
			'background_jobs.enqueue',
			{ tenantId: job.tenantId, entity: 'background_jobs' },
			async () => {
				const query = this.db.insert(backgroundJobs).values({
					id: job.id,
					tenantId: job.tenantId,
					type: job.type,
					status: job.status,
					payload: job.payload,
					result: job.result,
					error: job.error,
					queuedAt: job.queuedAt,
					startedAt: job.startedAt,
					finishedAt: job.finishedAt,
				});

				if (query.execute) {
					await query.execute();
				}
			},
		);
	}

	async claimNext(input: { nowIso: string; runningTimeoutMs: number }) {
		const execute = this.db.execute;
		if (!execute) {
			return null;
		}

		return withDbSpan(
			'background_jobs.claim_next',
			{ entity: 'background_jobs' },
			async () => {
				const claimStartedAt = new Date(input.nowIso);
				const staleBefore = new Date(
					Date.parse(input.nowIso) - input.runningTimeoutMs,
				);
				const result = await execute(sql`
					with candidate as (
						select
							${backgroundJobs.id} as id,
							${backgroundJobs.tenantId} as tenant_id
						from ${backgroundJobs}
						where
							${backgroundJobs.status} = 'queued'
							or (
								${backgroundJobs.status} = 'running'
								and coalesce(${backgroundJobs.startedAt}, ${backgroundJobs.queuedAt}) < ${staleBefore}
							)
						order by ${backgroundJobs.queuedAt} asc
						for update skip locked
						limit 1
					)
					update ${backgroundJobs}
					set
						${backgroundJobs.status} = 'running',
						${backgroundJobs.startedAt} = ${claimStartedAt},
						${backgroundJobs.finishedAt} = null,
						${backgroundJobs.error} = null
					from candidate
					where
						${backgroundJobs.id} = candidate.id
						and ${backgroundJobs.tenantId} = candidate.tenant_id
					returning
						${backgroundJobs.id} as id,
						${backgroundJobs.tenantId} as tenant_id,
						${backgroundJobs.type} as type,
						${backgroundJobs.status} as status,
						${backgroundJobs.payload} as payload,
						${backgroundJobs.result} as result,
						${backgroundJobs.error} as error,
						${backgroundJobs.queuedAt} as queued_at,
						${backgroundJobs.startedAt} as started_at,
						${backgroundJobs.finishedAt} as finished_at
				`);
				const rows = rowsFromExecuteResult(result);
				return rows[0] ? toBackgroundJob(rows[0]) : null;
			},
		);
	}

	async update(job: BackgroundJob) {
		const update = this.db.update;
		if (!update) {
			return;
		}

		await withDbSpan(
			'background_jobs.update',
			{ tenantId: job.tenantId, entity: 'background_jobs' },
			async () => {
				await update(backgroundJobs)
					.set({
						status: job.status,
						payload: job.payload,
						result: job.result,
						error: job.error,
						startedAt: job.startedAt,
						finishedAt: job.finishedAt,
					})
					.where(
						and(
							eq(backgroundJobs.id, job.id),
							eq(backgroundJobs.tenantId, job.tenantId),
						),
					);
			},
		);
	}

	async getById(jobId: string, tenantId?: string) {
		const select = this.db.select;
		if (!select) {
			return null;
		}

		return withDbSpan(
			'background_jobs.get_by_id',
			{ tenantId, entity: 'background_jobs' },
			async () => {
				const where = tenantId
					? and(
							eq(backgroundJobs.id, jobId),
							eq(backgroundJobs.tenantId, tenantId),
						)
					: eq(backgroundJobs.id, jobId);
				const rows = await select().from(backgroundJobs).where(where);
				return rows.map((row) => toBackgroundJob(row))[0] ?? null;
			},
		);
	}

	async list(limit: number, tenantId?: string) {
		const select = this.db.select;
		if (!select) {
			return [];
		}

		return withDbSpan(
			'background_jobs.list',
			{ tenantId, entity: 'background_jobs' },
			async () => {
				const rows = tenantId
					? await select()
							.from(backgroundJobs)
							.where(eq(backgroundJobs.tenantId, tenantId))
					: await select().from(backgroundJobs).where(sql`true`);

				return rows
					.map((row) => toBackgroundJob(row))
					.sort(byNewestQueued)
					.slice(0, Math.max(1, Math.min(200, limit)));
			},
		);
	}

	async resetForTests() {
		await withDbSpan(
			'background_jobs.reset_for_tests',
			{ entity: 'background_jobs' },
			async () => {
				await this.db.delete(backgroundJobs).where(sql`true`);
			},
		);
	}
}
