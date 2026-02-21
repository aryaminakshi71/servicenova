import { and, eq, sql } from "drizzle-orm";
import { backgroundJobs } from "../../../drizzle/schema";
import type { BackgroundJob, BackgroundJobStore } from "../background-jobs";

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

function toBackgroundJob(row: Record<string, unknown>): BackgroundJob {
  return {
    id: String(row.id),
    tenantId: String(row.tenantId ?? row.tenant_id ?? "default"),
    type: String(row.type) as BackgroundJob["type"],
    status: String(row.status) as BackgroundJob["status"],
    payload: (row.payload ?? {}) as Record<string, unknown>,
    result: (row.result ?? null) as unknown,
    error: (row.error ?? null) as string | null,
    queuedAt: String(row.queuedAt ?? row.queued_at ?? new Date().toISOString()),
    startedAt: (row.startedAt ?? row.started_at ?? null) as string | null,
    finishedAt: (row.finishedAt ?? row.finished_at ?? null) as string | null,
  };
}

function byOldestQueued(a: BackgroundJob, b: BackgroundJob) {
  return Date.parse(a.queuedAt) - Date.parse(b.queuedAt);
}

function byNewestQueued(a: BackgroundJob, b: BackgroundJob) {
  return Date.parse(b.queuedAt) - Date.parse(a.queuedAt);
}

export class DrizzleBackgroundJobsRepository implements BackgroundJobStore {
  constructor(private readonly db: DrizzleDb) {}

  async enqueue(job: BackgroundJob) {
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
  }

  async nextQueued() {
    if (!this.db.select) {
      return null;
    }

    const rows = await this.db
      .select()
      .from(backgroundJobs)
      .where(eq(backgroundJobs.status, "queued"));
    return (
      rows.map((row) => toBackgroundJob(row)).sort(byOldestQueued)[0] ?? null
    );
  }

  async update(job: BackgroundJob) {
    if (!this.db.update) {
      return;
    }

    await this.db
      .update(backgroundJobs)
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
  }

  async getById(jobId: string, tenantId?: string) {
    if (!this.db.select) {
      return null;
    }

    const where = tenantId
      ? and(eq(backgroundJobs.id, jobId), eq(backgroundJobs.tenantId, tenantId))
      : eq(backgroundJobs.id, jobId);
    const rows = await this.db.select().from(backgroundJobs).where(where);
    return rows.map((row) => toBackgroundJob(row))[0] ?? null;
  }

  async list(limit: number, tenantId?: string) {
    if (!this.db.select) {
      return [];
    }

    const rows = tenantId
      ? await this.db
          .select()
          .from(backgroundJobs)
          .where(eq(backgroundJobs.tenantId, tenantId))
      : await this.db.select().from(backgroundJobs).where(sql`true`);

    return rows
      .map((row) => toBackgroundJob(row))
      .sort(byNewestQueued)
      .slice(0, Math.max(1, Math.min(200, limit)));
  }

  async resetForTests() {
    await this.db.delete(backgroundJobs).where(sql`true`);
  }
}
