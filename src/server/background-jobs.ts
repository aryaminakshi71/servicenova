import {
  handleDispatchDisruption,
  listJobs,
  listTechnicians,
  optimizeDispatchAssignments,
} from "../features/field-ops";
import { getDisruptionFeedProvider } from "../features/field-ops/disruption-feed";
import { runWithTenantContext } from "../features/field-ops/tenant-context";
import { flushIntegrationOutbox } from "../features/integrations";
import { featureFlags } from "./flags";

export type BackgroundJobType =
  | "dispatch_auto_disruption"
  | "dispatch_optimize"
  | "integration_outbox_flush";
export type BackgroundJobStatus = "queued" | "running" | "completed" | "failed";

export type BackgroundJob = {
  id: string;
  type: BackgroundJobType;
  tenantId: string;
  status: BackgroundJobStatus;
  payload: Record<string, unknown>;
  result: unknown;
  error: string | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export interface BackgroundJobStore {
  enqueue(job: BackgroundJob): Promise<void>;
  nextQueued(): Promise<BackgroundJob | null>;
  update(job: BackgroundJob): Promise<void>;
  getById(jobId: string, tenantId?: string): Promise<BackgroundJob | null>;
  list(limit: number, tenantId?: string): Promise<BackgroundJob[]>;
  resetForTests(): Promise<void>;
}

let processing = false;
let outboxTimer: ReturnType<typeof setInterval> | null = null;

function nowIso() {
  return new Date().toISOString();
}

function parseIntEnv(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name];

  if (raw === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);

  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function normalizeTenantId(value: string | null | undefined) {
  return value?.trim() || "default";
}

function byNewestQueued(a: BackgroundJob, b: BackgroundJob) {
  return Date.parse(b.queuedAt) - Date.parse(a.queuedAt);
}

function createInMemoryBackgroundJobStore(): BackgroundJobStore {
  let jobs: BackgroundJob[] = [];

  return {
    async enqueue(job) {
      jobs.unshift(job);
      jobs = jobs.slice(0, 5_000);
    },
    async nextQueued() {
      const queued = jobs
        .filter((job) => job.status === "queued")
        .sort((a, b) => Date.parse(a.queuedAt) - Date.parse(b.queuedAt));
      return queued[0] ?? null;
    },
    async update(job) {
      jobs = jobs.map((existing) => (existing.id === job.id ? job : existing));
    },
    async getById(jobId, tenantId) {
      const normalizedTenant = tenantId?.trim() || null;
      return (
        jobs.find(
          (job) =>
            job.id === jobId &&
            (normalizedTenant ? job.tenantId === normalizedTenant : true),
        ) ?? null
      );
    },
    async list(limit, tenantId) {
      const normalizedTenant = tenantId?.trim() || null;
      return jobs
        .filter((job) =>
          normalizedTenant ? job.tenantId === normalizedTenant : true,
        )
        .sort(byNewestQueued)
        .slice(0, Math.max(1, Math.min(200, limit)));
    },
    async resetForTests() {
      jobs = [];
    },
  };
}

let backgroundJobStore: BackgroundJobStore = createInMemoryBackgroundJobStore();

export function configureBackgroundJobStore(store: BackgroundJobStore) {
  backgroundJobStore = store;
}

export function useInMemoryBackgroundJobStore() {
  backgroundJobStore = createInMemoryBackgroundJobStore();
}

async function runAutoDisruption(payload: Record<string, unknown>) {
  const provider = getDisruptionFeedProvider();
  const signals = await provider.pollSignals({
    jobs: listJobs(),
    technicians: listTechnicians(),
  });
  const maxSignals = Math.min(
    50,
    Math.max(1, Number(payload["maxSignals"] ?? 10)),
  );
  const actor = String(payload["actor"] ?? "system");
  const processed: Array<{
    signalId: string;
    type: string;
    severity: string;
    result: unknown;
  }> = [];

  for (const signal of signals.slice(0, maxSignals)) {
    const result = handleDispatchDisruption({
      type: signal.type,
      reason: signal.reason,
      technicianId: signal.technicianId,
      affectedJobIds: signal.affectedJobIds,
      actor,
    });

    processed.push({
      signalId: signal.signalId,
      type: signal.type,
      severity: signal.severity,
      result,
    });
  }

  return {
    detectedSignals: signals.length,
    processedSignals: processed.length,
    processed,
  };
}

async function executeJob(job: BackgroundJob) {
  if (job.type === "dispatch_auto_disruption") {
    return runAutoDisruption(job.payload);
  }

  if (job.type === "dispatch_optimize") {
    return optimizeDispatchAssignments({
      includeAssigned:
        typeof job.payload["includeAssigned"] === "boolean"
          ? (job.payload["includeAssigned"] as boolean)
          : undefined,
      reason:
        typeof job.payload["reason"] === "string"
          ? (job.payload["reason"] as string)
          : undefined,
      actor:
        typeof job.payload["actor"] === "string"
          ? (job.payload["actor"] as string)
          : undefined,
    });
  }

  return flushIntegrationOutbox({
    maxBatch: Number(job.payload["maxBatch"] ?? 25),
    includeAllTenants: true,
  });
}

async function processQueue() {
  if (processing) {
    return;
  }

  processing = true;

  try {
    while (true) {
      const next = await backgroundJobStore.nextQueued();

      if (!next) {
        break;
      }

      const startedAt = nowIso();
      const running: BackgroundJob = {
        ...next,
        status: "running",
        startedAt,
      };
      await backgroundJobStore.update(running);

      try {
        const result = await runWithTenantContext(next.tenantId, () =>
          executeJob(next),
        );
        await backgroundJobStore.update({
          ...running,
          status: "completed",
          result,
          error: null,
          finishedAt: nowIso(),
        });
      } catch (error) {
        await backgroundJobStore.update({
          ...running,
          status: "failed",
          error: String(error),
          finishedAt: nowIso(),
        });
      }
    }
  } finally {
    processing = false;
  }
}

export async function enqueueBackgroundJob(input: {
  type: BackgroundJobType;
  tenantId: string;
  payload?: Record<string, unknown>;
}) {
  const queuedAt = nowIso();
  const job: BackgroundJob = {
    id: `job-${crypto.randomUUID()}`,
    type: input.type,
    tenantId: normalizeTenantId(input.tenantId),
    status: "queued",
    payload: input.payload ?? {},
    result: null,
    error: null,
    queuedAt,
    startedAt: null,
    finishedAt: null,
  };

  await backgroundJobStore.enqueue(job);
  void processQueue();
  return job;
}

export function getBackgroundJob(jobId: string, tenantId?: string) {
  return backgroundJobStore.getById(jobId, tenantId);
}

export function listBackgroundJobs(limit = 50, tenantId?: string) {
  return backgroundJobStore.list(limit, tenantId);
}

export function startBackgroundJobsRuntime() {
  if (!featureFlags.backgroundWorkers || !featureFlags.integrationOutbox) {
    return;
  }

  if (outboxTimer) {
    return;
  }

  const flushMs = parseIntEnv(
    "INTEGRATION_OUTBOX_FLUSH_MS",
    4_000,
    500,
    120_000,
  );
  outboxTimer = setInterval(() => {
    void enqueueBackgroundJob({
      type: "integration_outbox_flush",
      tenantId: "default",
      payload: {
        maxBatch: parseIntEnv("INTEGRATION_OUTBOX_FLUSH_BATCH", 25, 1, 200),
      },
    });
  }, flushMs);
}

export function stopBackgroundJobsRuntime() {
  if (outboxTimer) {
    clearInterval(outboxTimer);
    outboxTimer = null;
  }
}

export async function resetBackgroundJobsForTests() {
  processing = false;
  stopBackgroundJobsRuntime();
  await backgroundJobStore.resetForTests();
  useInMemoryBackgroundJobStore();
}
