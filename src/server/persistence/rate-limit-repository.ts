import { lt, sql } from 'drizzle-orm';
import { rateLimitCounters } from '../../../drizzle/schema';
import type { RateLimitStore } from '../rate-limit';
import { withDbSpan } from './db-tracing';

type DrizzleDb = {
	insert: (table: unknown) => {
		values: (value: unknown) => {
			onConflictDoUpdate: (config: unknown) => {
				returning: (
					selection: unknown,
				) => Promise<Array<Record<string, unknown>>>;
			};
		};
	};
	delete: (table: unknown) => {
		where: (filter: unknown) => Promise<unknown>;
	};
};

function tenantFromScopeKey(scopeKey: string) {
	const parts = scopeKey.split(':');
	return parts[1]?.trim() || 'default';
}

export class DrizzleRateLimitRepository implements RateLimitStore {
	constructor(private readonly db: DrizzleDb) {}

	async increment(scopeKey: string, windowMs: number, nowMs: number) {
		const tenantId = tenantFromScopeKey(scopeKey);
		return withDbSpan(
			'rate_limit.increment',
			{ tenantId, entity: 'rate_limit_counters' },
			async () => {
				const now = new Date(nowMs);
				const resetAt = new Date(nowMs + windowMs);
				const dbAny = this.db as unknown as {
					insert: DrizzleDb['insert'];
				};

				const rows = await dbAny
					.insert(rateLimitCounters)
					.values({
						scopeKey,
						tenantId,
						hitCount: 1,
						resetAt,
						updatedAt: now,
					})
					.onConflictDoUpdate({
						target: rateLimitCounters.scopeKey,
						set: {
							hitCount: sql<number>`CASE WHEN ${rateLimitCounters.resetAt} <= ${now} THEN 1 ELSE ${rateLimitCounters.hitCount} + 1 END`,
							resetAt: sql<Date>`CASE WHEN ${rateLimitCounters.resetAt} <= ${now} THEN ${resetAt} ELSE ${rateLimitCounters.resetAt} END`,
							tenantId,
							updatedAt: now,
						},
					})
					.returning({
						hitCount: rateLimitCounters.hitCount,
						resetAt: rateLimitCounters.resetAt,
					});

				const row = rows[0];

				return {
					count: Number(row?.hitCount ?? 1),
					resetAt:
						row?.resetAt instanceof Date
							? row.resetAt.getTime()
							: Date.parse(String(row?.resetAt ?? resetAt)),
				};
			},
		);
	}

	async cleanup(beforeMs: number) {
		await withDbSpan(
			'rate_limit.cleanup',
			{ entity: 'rate_limit_counters' },
			async () => {
				await this.db
					.delete(rateLimitCounters)
					.where(lt(rateLimitCounters.resetAt, new Date(beforeMs)));
			},
		);
	}
}
