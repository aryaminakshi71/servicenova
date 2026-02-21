import { and, eq, lte, sql } from "drizzle-orm";
import { integrationOutbox } from "../../../drizzle/schema";
import type {
  IntegrationOutboxEntry,
  IntegrationOutboxStatus,
  IntegrationOutboxStore,
} from "../../features/integrations/outbox";

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
};

function toEntry(row: Record<string, unknown>): IntegrationOutboxEntry {
  return {
    id: String(row.id),
    tenantId: String(row.tenantId ?? row.tenant_id ?? "default"),
    type: (row.type ??
      "crm_work_order_event") as IntegrationOutboxEntry["type"],
    status: (row.status ?? "pending") as IntegrationOutboxStatus,
    payload: (row.payload ?? {}) as IntegrationOutboxEntry["payload"],
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

export class DrizzleIntegrationOutboxRepository
  implements IntegrationOutboxStore
{
  constructor(private readonly db: DrizzleDb) {}

  async enqueue(entry: IntegrationOutboxEntry) {
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
  }

  async list(input: {
    tenantId: string;
    status?: IntegrationOutboxStatus;
    limit: number;
  }) {
    if (!this.db.select) {
      return [];
    }

    const rows = await this.db
      .select()
      .from(integrationOutbox)
      .where(eq(integrationOutbox.tenantId, input.tenantId));
    return rows
      .map((row) => toEntry(row))
      .filter((entry) => (input.status ? entry.status === input.status : true))
      .sort(byNewestUpdated)
      .slice(0, input.limit);
  }

  async duePending(input: {
    tenantId: string;
    includeAllTenants: boolean;
    maxBatch: number;
    nowIso: string;
  }) {
    if (!this.db.select) {
      return [];
    }

    const where = input.includeAllTenants
      ? and(
          eq(integrationOutbox.status, "pending"),
          lte(integrationOutbox.nextAttemptAt, new Date(input.nowIso)),
        )
      : and(
          eq(integrationOutbox.tenantId, input.tenantId),
          eq(integrationOutbox.status, "pending"),
          lte(integrationOutbox.nextAttemptAt, new Date(input.nowIso)),
        );

    const rows = await this.db.select().from(integrationOutbox).where(where);
    return rows
      .map((row) => toEntry(row))
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
      .slice(0, input.maxBatch);
  }

  async update(entry: IntegrationOutboxEntry) {
    if (!this.db.update) {
      return;
    }

    await this.db
      .update(integrationOutbox)
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
  }

  async summary(tenantId: string) {
    const entries = await this.list({ tenantId, limit: 5_000 });
    return {
      total: entries.length,
      pending: entries.filter((entry) => entry.status === "pending").length,
      processing: entries.filter((entry) => entry.status === "processing")
        .length,
      delivered: entries.filter((entry) => entry.status === "delivered").length,
      deadLetter: entries.filter((entry) => entry.status === "dead_letter")
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
      status: "dead_letter",
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
        status: "pending",
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
    await this.db.delete(integrationOutbox).where(sql`true`);
  }
}
