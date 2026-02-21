import { and, eq, lt } from "drizzle-orm";
import { idempotencyKeys } from "../../../drizzle/schema";
import type { IdempotencyCacheRecord, IdempotencyStore } from "../idempotency";

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
  delete: (table: unknown) => {
    where: (filter: unknown) => Promise<unknown>;
  };
};

function toRecord(row: Record<string, unknown>): IdempotencyCacheRecord {
  return {
    status: Number(row.responseStatus ?? row.response_status ?? 200),
    body: (row.responseBody ?? row.response_body ?? {}) as unknown,
    createdAt: Date.parse(
      String(row.createdAt ?? row.created_at ?? new Date().toISOString()),
    ),
  };
}

function tenantFromScope(scope: string) {
  const parsed = scope.split(":")[0]?.trim();
  return parsed || "default";
}

export class DrizzleIdempotencyRepository implements IdempotencyStore {
  constructor(private readonly db: DrizzleDb) {}

  async get(scope: string): Promise<IdempotencyCacheRecord | null> {
    if (!this.db.select) {
      return null;
    }

    const tenantId = tenantFromScope(scope);
    const rows = await this.db
      .select()
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.tenantId, tenantId),
          eq(idempotencyKeys.scopeKey, scope),
        ),
      );

    if (rows.length === 0) {
      return null;
    }

    const latest = rows
      .map((row) => toRecord(row))
      .sort((a, b) => b.createdAt - a.createdAt)[0];

    return latest;
  }

  async set(scope: string, entry: IdempotencyCacheRecord): Promise<void> {
    const tenantId = tenantFromScope(scope);
    await this.db
      .delete(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.tenantId, tenantId),
          eq(idempotencyKeys.scopeKey, scope),
        ),
      );

    const query = this.db.insert(idempotencyKeys).values({
      tenantId,
      scopeKey: scope,
      responseStatus: entry.status,
      responseBody: entry.body,
      createdAt: new Date(entry.createdAt),
    });

    if (query.execute) {
      await query.execute();
    }
  }

  async cleanup(ttlMs: number): Promise<void> {
    const threshold = new Date(Date.now() - ttlMs);
    await this.db
      .delete(idempotencyKeys)
      .where(lt(idempotencyKeys.createdAt, threshold));
  }
}
