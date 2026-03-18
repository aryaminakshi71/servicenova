import { and, eq, sql } from 'drizzle-orm';
import { integrationOutbox } from '../../../drizzle/schema';
import type {
	IntegrationOutboxEntry,
	IntegrationOutboxStatus,
	IntegrationOutboxStore,
} from '../../features/integrations/outbox';
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

function toEntry(row: Record<string, unknown>): IntegrationOutboxEntry {
	return {
		id: String(row.id),
		tenantId: String(row.tenantId ?? row.tenant_id ?? 'default'),
		type: (row.type ??
			'crm_work_order_event') as IntegrationOutboxEntry['type'],
		status: (row.status ?? 'pending') as IntegrationOutboxStatus,
		payload: (row.payload ?? {}) as IntegrationOutboxEntry['payload'],
		attempts: Number(row.attempts ?? 0),
		nextAttemptAt: String(
			row.nextAttemptAt ?? row.next_attempt_at ?? new Date().toISOString(),
		),
		createdAt: String(
			row.createdAt ?? row.created_at ?? new Date().toISOString(),
		),
		updatedAt: String(
			row.updatedAt ?? row.updated_at ?? new Date().toISOString(),
		),
		deliveredAt: (row.deliveredAt ?? row.delivered_at ?? null) as string | null,
		lastError: (row.lastError ?? row.last_error ?? null) as string | null,
	};
}

function byNewestUpdated(a: IntegrationOutboxEntry, b: IntegrationOutboxEntry) {
	return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
}

function rowsFromExecuteResult(
	result:
		| { rows?: Array<Record<string, unknown>> }
		| Array<Record<string, unknown>>,
) {
	return Array.isArray(result) ? result : (result.rows ?? []);
}

export class DrizzleIntegrationOutboxRepository
	implements IntegrationOutboxStore
{
	constructor(private readonly db: DrizzleDb) {}

	async enqueue(entry: IntegrationOutboxEntry) {
		await withDbSpan(
			'integration_outbox.enqueue',
			{ tenantId: entry.tenantId, entity: 'integration_outbox' },
			async () => {
				const query = this.db.insert(integrationOutbox).values({
					id: entry.id,
					tenantId: entry.tenantId,
					type: entry.type,
					status: entry.status,
					payload: entry.payload,
					attempts: entry.attempts,
					nextAttemptAt: entry.nextAttemptAt,
					createdAt: entry.createdAt,
					updatedAt: entry.updatedAt,
					deliveredAt: entry.deliveredAt,
					lastError: entry.lastError,
				});

				if (query.execute) {
					await query.execute();
				}
			},
		);
	}

	async list(input: {
		tenantId: string;
		status?: IntegrationOutboxStatus;
		limit: number;
	}) {
		const select = this.db.select;
		if (!select) {
			return [];
		}

		return withDbSpan(
			'integration_outbox.list',
			{ tenantId: input.tenantId, entity: 'integration_outbox' },
			async () => {
				const rows = await select()
					.from(integrationOutbox)
					.where(eq(integrationOutbox.tenantId, input.tenantId));
				return rows
					.map((row) => toEntry(row))
					.filter((entry) =>
						input.status ? entry.status === input.status : true,
					)
					.sort(byNewestUpdated)
					.slice(0, input.limit);
			},
		);
	}

	async claimNext(input: {
		tenantId: string;
		includeAllTenants: boolean;
		nowIso: string;
		processingTimeoutMs: number;
	}) {
		const execute = this.db.execute;
		if (!execute) {
			return null;
		}

		return withDbSpan(
			'integration_outbox.claim_next',
			{
				tenantId: input.includeAllTenants ? 'all' : input.tenantId,
				entity: 'integration_outbox',
			},
			async () => {
				const staleBefore = new Date(
					Date.parse(input.nowIso) - input.processingTimeoutMs,
				);
				const updatedAt = new Date(input.nowIso);
				const tenantClause = input.includeAllTenants
					? sql`true`
					: sql`${integrationOutbox.tenantId} = ${input.tenantId}`;
				const result = await execute(sql`
					with candidate as (
						select
							${integrationOutbox.id} as id,
							${integrationOutbox.tenantId} as tenant_id
						from ${integrationOutbox}
						where
							${tenantClause}
							and (
								(
									${integrationOutbox.status} = 'pending'
									and ${integrationOutbox.nextAttemptAt} <= ${updatedAt}
								)
								or (
									${integrationOutbox.status} = 'processing'
									and ${integrationOutbox.updatedAt} < ${staleBefore}
								)
							)
						order by ${integrationOutbox.createdAt} asc
						for update skip locked
						limit 1
					)
					update ${integrationOutbox}
					set
						${integrationOutbox.status} = 'processing',
						${integrationOutbox.updatedAt} = ${updatedAt}
					from candidate
					where
						${integrationOutbox.id} = candidate.id
						and ${integrationOutbox.tenantId} = candidate.tenant_id
					returning
						${integrationOutbox.id} as id,
						${integrationOutbox.tenantId} as tenant_id,
						${integrationOutbox.type} as type,
						${integrationOutbox.status} as status,
						${integrationOutbox.payload} as payload,
						${integrationOutbox.attempts} as attempts,
						${integrationOutbox.nextAttemptAt} as next_attempt_at,
						${integrationOutbox.createdAt} as created_at,
						${integrationOutbox.updatedAt} as updated_at,
						${integrationOutbox.deliveredAt} as delivered_at,
						${integrationOutbox.lastError} as last_error
				`);
				const rows = rowsFromExecuteResult(result);
				return rows[0] ? toEntry(rows[0]) : null;
			},
		);
	}

	async update(entry: IntegrationOutboxEntry) {
		const update = this.db.update;
		if (!update) {
			return;
		}

		await withDbSpan(
			'integration_outbox.update',
			{ tenantId: entry.tenantId, entity: 'integration_outbox' },
			async () => {
				await update(integrationOutbox)
					.set({
						status: entry.status,
						payload: entry.payload,
						attempts: entry.attempts,
						nextAttemptAt: entry.nextAttemptAt,
						updatedAt: entry.updatedAt,
						deliveredAt: entry.deliveredAt,
						lastError: entry.lastError,
					})
					.where(
						and(
							eq(integrationOutbox.id, entry.id),
							eq(integrationOutbox.tenantId, entry.tenantId),
						),
					);
			},
		);
	}

	async summary(tenantId: string) {
		const entries = await this.list({ tenantId, limit: 5_000 });
		return {
			total: entries.length,
			pending: entries.filter((entry) => entry.status === 'pending').length,
			processing: entries.filter((entry) => entry.status === 'processing')
				.length,
			delivered: entries.filter((entry) => entry.status === 'delivered').length,
			deadLetter: entries.filter((entry) => entry.status === 'dead_letter')
				.length,
		};
	}

	async requeueDeadLetters(input: {
		tenantId: string;
		ids?: string[];
		limit: number;
		nowIso: string;
	}) {
		const entries = await this.list({
			tenantId: input.tenantId,
			status: 'dead_letter',
			limit: 5_000,
		});
		const selectedIds = input.ids?.length ? new Set(input.ids) : null;
		const candidates = entries
			.filter((entry) => (selectedIds ? selectedIds.has(entry.id) : true))
			.slice(0, input.limit);
		const refreshed: IntegrationOutboxEntry[] = [];

		for (const entry of candidates) {
			const updated: IntegrationOutboxEntry = {
				...entry,
				status: 'pending',
				attempts: 0,
				nextAttemptAt: input.nowIso,
				updatedAt: input.nowIso,
				deliveredAt: null,
				lastError: null,
			};
			await this.update(updated);
			refreshed.push(updated);
		}

		return {
			requeued: refreshed.length,
			entries: refreshed.sort(byNewestUpdated),
		};
	}

	async resetForTests() {
		await withDbSpan(
			'integration_outbox.reset_for_tests',
			{ entity: 'integration_outbox' },
			async () => {
				await this.db.delete(integrationOutbox).where(sql`true`);
			},
		);
	}
}
