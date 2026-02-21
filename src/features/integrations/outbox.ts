import {
  currentTenantId,
  runWithTenantContext,
} from "../field-ops/tenant-context";
import type { CrmWorkOrderEvent } from "./adapters";
import { getIntegrationAdapters } from "./runtime";

export type IntegrationOutboxStatus =
  | "pending"
  | "processing"
  | "delivered"
  | "dead_letter";

export type IntegrationOutboxEntry = {
  id: string;
  tenantId: string;
  type: "crm_work_order_event";
  status: IntegrationOutboxStatus;
  payload: CrmWorkOrderEvent;
  attempts: number;
  nextAttemptAt: string;
  createdAt: string;
  updatedAt: string;
  deliveredAt: string | null;
  lastError: string | null;
};

type IntegrationOutboxSummary = {
  total: number;
  pending: number;
  processing: number;
  delivered: number;
  deadLetter: number;
};

export interface IntegrationOutboxStore {
  enqueue(entry: IntegrationOutboxEntry): Promise<void>;
  list(input: {
    tenantId: string;
    status?: IntegrationOutboxStatus;
    limit: number;
  }): Promise<IntegrationOutboxEntry[]>;
  duePending(input: {
    tenantId: string;
    includeAllTenants: boolean;
    maxBatch: number;
    nowIso: string;
  }): Promise<IntegrationOutboxEntry[]>;
  update(entry: IntegrationOutboxEntry): Promise<void>;
  summary(tenantId: string): Promise<IntegrationOutboxSummary>;
  requeueDeadLetters(input: {
    tenantId: string;
    ids?: string[];
    limit: number;
    nowIso: string;
  }): Promise<{ requeued: number; entries: IntegrationOutboxEntry[] }>;
  resetForTests(): Promise<void>;
}

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

function retryDelayMs(attempts: number) {
  const base = parseIntEnv(
    "INTEGRATION_OUTBOX_RETRY_BASE_MS",
    2_000,
    100,
    120_000,
  );
  const cap = parseIntEnv(
    "INTEGRATION_OUTBOX_RETRY_CAP_MS",
    60_000,
    1_000,
    600_000,
  );
  const exponent = Math.max(0, attempts - 1);
  return Math.min(cap, base * 2 ** exponent);
}

function maxAttempts() {
  return parseIntEnv("INTEGRATION_OUTBOX_MAX_ATTEMPTS", 5, 1, 30);
}

function byNewestUpdated(a: IntegrationOutboxEntry, b: IntegrationOutboxEntry) {
  return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
}

function createInMemoryOutboxStore(): IntegrationOutboxStore {
  let entries: IntegrationOutboxEntry[] = [];

  return {
    async enqueue(entry) {
      entries.unshift(entry);
      entries = entries.slice(0, 5_000);
    },
    async list(input) {
      return entries
        .filter((entry) => entry.tenantId === input.tenantId)
        .filter((entry) =>
          input.status ? entry.status === input.status : true,
        )
        .sort(byNewestUpdated)
        .slice(0, input.limit);
    },
    async duePending(input) {
      const nowMs = Date.parse(input.nowIso);
      return entries
        .filter((entry) =>
          input.includeAllTenants ? true : entry.tenantId === input.tenantId,
        )
        .filter((entry) => entry.status === "pending")
        .filter((entry) => Date.parse(entry.nextAttemptAt) <= nowMs)
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
        .slice(0, input.maxBatch);
    },
    async update(entry) {
      entries = entries.map((existing) =>
        existing.id === entry.id ? entry : existing,
      );
    },
    async summary(tenantId) {
      const scoped = entries.filter((entry) => entry.tenantId === tenantId);
      return {
        total: scoped.length,
        pending: scoped.filter((entry) => entry.status === "pending").length,
        processing: scoped.filter((entry) => entry.status === "processing")
          .length,
        delivered: scoped.filter((entry) => entry.status === "delivered")
          .length,
        deadLetter: scoped.filter((entry) => entry.status === "dead_letter")
          .length,
      };
    },
    async requeueDeadLetters(input) {
      let requeued = 0;
      const selectedIds = input.ids?.length ? new Set(input.ids) : null;
      const refreshed: IntegrationOutboxEntry[] = [];

      entries = entries.map((entry) => {
        const matchesTenant = entry.tenantId === input.tenantId;
        const matchesStatus = entry.status === "dead_letter";
        const matchesId = selectedIds ? selectedIds.has(entry.id) : true;

        if (
          !matchesTenant ||
          !matchesStatus ||
          !matchesId ||
          requeued >= input.limit
        ) {
          return entry;
        }

        requeued += 1;
        const updated: IntegrationOutboxEntry = {
          ...entry,
          status: "pending",
          attempts: 0,
          nextAttemptAt: input.nowIso,
          updatedAt: input.nowIso,
          deliveredAt: null,
          lastError: null,
        };
        refreshed.push(updated);
        return updated;
      });

      return {
        requeued,
        entries: refreshed.sort(byNewestUpdated),
      };
    },
    async resetForTests() {
      entries = [];
    },
  };
}

let outboxStore: IntegrationOutboxStore = createInMemoryOutboxStore();

export function configureIntegrationOutboxStore(store: IntegrationOutboxStore) {
  outboxStore = store;
}

export function useInMemoryIntegrationOutboxStore() {
  outboxStore = createInMemoryOutboxStore();
}

export async function enqueueCrmWorkOrderEvent(payload: CrmWorkOrderEvent) {
  const now = nowIso();
  const entry: IntegrationOutboxEntry = {
    id: `outbox-${crypto.randomUUID()}`,
    tenantId: normalizeTenantId(currentTenantId()),
    type: "crm_work_order_event",
    status: "pending",
    payload,
    attempts: 0,
    nextAttemptAt: now,
    createdAt: now,
    updatedAt: now,
    deliveredAt: null,
    lastError: null,
  };

  await outboxStore.enqueue(entry);
  return entry;
}

export async function listIntegrationOutboxEntries(input?: {
  status?: IntegrationOutboxStatus;
  limit?: number;
}) {
  const tenantId = normalizeTenantId(currentTenantId());
  const limit = Math.min(500, Math.max(1, input?.limit ?? 50));
  return outboxStore.list({
    tenantId,
    status: input?.status,
    limit,
  });
}

export async function flushIntegrationOutbox(input?: {
  maxBatch?: number;
  tenantId?: string;
  includeAllTenants?: boolean;
}) {
  const now = nowIso();
  const maxBatch = Math.min(200, Math.max(1, input?.maxBatch ?? 25));
  const tenantId = normalizeTenantId(input?.tenantId ?? currentTenantId());
  const dueEntries = await outboxStore.duePending({
    tenantId,
    includeAllTenants: input?.includeAllTenants ?? false,
    maxBatch,
    nowIso: now,
  });

  let delivered = 0;
  let failed = 0;
  let deadLettered = 0;

  for (const entry of dueEntries) {
    const processingAt = nowIso();
    const processing: IntegrationOutboxEntry = {
      ...entry,
      status: "processing",
      updatedAt: processingAt,
    };
    await outboxStore.update(processing);

    try {
      await runWithTenantContext(entry.tenantId, async () => {
        const adapters = getIntegrationAdapters();

        if (entry.type === "crm_work_order_event") {
          await adapters.crm.recordWorkOrderEvent(entry.payload);
        }
      });

      const deliveredAt = nowIso();
      await outboxStore.update({
        ...processing,
        status: "delivered",
        deliveredAt,
        updatedAt: deliveredAt,
        lastError: null,
      });
      delivered += 1;
    } catch (error) {
      const attempts = processing.attempts + 1;
      const updatedAt = nowIso();
      const isDeadLetter = attempts >= maxAttempts();
      await outboxStore.update({
        ...processing,
        status: isDeadLetter ? "dead_letter" : "pending",
        attempts,
        nextAttemptAt: isDeadLetter
          ? processing.nextAttemptAt
          : new Date(Date.now() + retryDelayMs(attempts)).toISOString(),
        updatedAt,
        lastError: String(error),
      });

      if (isDeadLetter) {
        deadLettered += 1;
      }

      failed += 1;
    }
  }

  return {
    processed: dueEntries.length,
    delivered,
    failed,
    deadLettered,
  };
}

export async function getIntegrationOutboxSummary() {
  const tenantId = normalizeTenantId(currentTenantId());
  return outboxStore.summary(tenantId);
}

export async function requeueIntegrationOutboxDeadLetters(input?: {
  ids?: string[];
  limit?: number;
}) {
  const tenantId = normalizeTenantId(currentTenantId());
  return outboxStore.requeueDeadLetters({
    tenantId,
    ids: input?.ids,
    limit: Math.min(500, Math.max(1, input?.limit ?? 100)),
    nowIso: nowIso(),
  });
}

export async function resetIntegrationOutboxForTests() {
  await outboxStore.resetForTests();
  useInMemoryIntegrationOutboxStore();
}
