import { type Context, Hono } from "hono";
import { z } from "zod";
import {
  addProofOfService,
  assessMaintenanceRisk,
  assignJob,
  completeJob,
  evaluateSlaBreaches,
  generateRoutePlan,
  generateTechnicianAssistBriefing,
  generateWorkOrderIntelligence,
  getAuditTrail,
  getDispatchBoard,
  getJobById,
  getJobChecklist,
  getOperationalKpis,
  getRoutePlans,
  getTechnicianAssistHistory,
  getUnassignedQueue,
  getWorkOrderIntelligenceAccuracy,
  getWorkOrderIntelligenceDriftAlerts,
  getWorkOrderIntelligenceHistory,
  getWorkOrderIntelligenceQualityReport,
  handleDispatchDisruption,
  listJobs,
  listTechnicians,
  optimizeDispatchAssignments,
  reassignJob,
  recordManualOverride,
  startJob,
  storeExternalTechnicianAssistBriefing,
  storeExternalWorkOrderIntelligence,
  triggerTrafficAwareReplanning,
  unassignJob,
  updateJobChecklist,
  updateTechnicianShift,
} from "../../features/field-ops";
import { getDisruptionFeedProvider } from "../../features/field-ops/disruption-feed";
import { getFieldIntelligenceProvider } from "../../features/field-ops/intelligence-provider";
import { runWithTenantContext } from "../../features/field-ops/tenant-context";
import {
  createInvoiceFromCompletedJob,
  flushIntegrationOutbox,
  getCustomerContext,
  getIntegrationOutboxSummary,
  getInvoice,
  listIntegrationOutboxEntries,
  listInvoices,
  requeueIntegrationOutboxDeadLetters,
  syncCrmWorkOrderEvent,
} from "../../features/integrations";
import { ensureRole, getAuth } from "../auth";
import {
  enqueueBackgroundJob,
  getBackgroundJob,
  listBackgroundJobs,
} from "../background-jobs";
import { featureFlags } from "../flags";
import {
  idempotencyKey,
  replayIdempotent,
  storeIdempotent,
} from "../idempotency";
import { getObservabilitySnapshot } from "../observability";
import { enforceRateLimit } from "../rate-limit";

export const fieldRoutes = new Hono();

fieldRoutes.use("*", async (c, next) => {
  const auth = getAuth(c);

  return runWithTenantContext(auth.tenantId, async () => {
    const isIntegrationPath = c.req.path.includes("/integrations/");

    if (isIntegrationPath) {
      const blocked = await enforceRateLimit(c, "integration");

      if (blocked) {
        return blocked;
      }
    } else if (c.req.method === "POST") {
      const blocked = await enforceRateLimit(c, "mutation");

      if (blocked) {
        return blocked;
      }
    }

    await next();
  });
});

const assignJobSchema = z.object({
  jobId: z.string().min(1),
  technicianId: z.string().min(1).optional(),
  actor: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
  expectedVersion: z.number().int().positive().optional(),
});

const reassignSchema = z.object({
  jobId: z.string().min(1),
  toTechnicianId: z.string().min(1),
  actor: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
  expectedVersion: z.number().int().positive().optional(),
});

const shiftSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
  actor: z.string().min(1).optional(),
});

const routePlanSchema = z.object({
  technicianId: z.string().min(1),
  date: z.string().min(10),
  trafficLevel: z.enum(["low", "normal", "high"]).optional(),
});

const routeReplanSchema = z.object({
  date: z.string().min(10),
  technicianId: z.string().min(1).optional(),
  trafficLevel: z.enum(["low", "normal", "high"]).optional(),
});

const checklistUpdateSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        done: z.boolean(),
      }),
    )
    .min(1),
});

const proofSchema = z.object({
  proofUrl: z.string().url(),
  note: z.string().min(1).optional(),
});

const completeJobSchema = z.object({
  completionNotes: z.string().min(1).optional(),
  firstTimeFix: z.boolean().optional(),
  actor: z.string().min(1).optional(),
  expectedVersion: z.number().int().positive().optional(),
});

const startJobSchema = z.object({
  actor: z.string().min(1).optional(),
  expectedVersion: z.number().int().positive().optional(),
});

const maintenanceRiskSchema = z.object({
  assetId: z.string().min(1),
  assetAgeMonths: z.number().int().nonnegative(),
  incidentsLast90Days: z.number().int().nonnegative(),
  avgRepairMinutes: z.number().int().nonnegative(),
  usageIntensity: z.enum(["low", "medium", "high"]),
});

const jobIntelligenceSchema = z.object({
  symptoms: z.array(z.string().min(1)).max(20).optional(),
  notes: z.string().min(1).max(2000).optional(),
});

const technicianAssistSchema = z.object({
  noteContext: z.string().min(1).max(500).optional(),
});

const disruptionSchema = z
  .object({
    type: z.enum([
      "technician_unavailable",
      "traffic_incident",
      "weather_alert",
    ]),
    technicianId: z.string().min(1).optional(),
    affectedJobIds: z.array(z.string().min(1)).max(100).optional(),
    reason: z.string().min(3).max(500),
    actor: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.type === "technician_unavailable" && !value.technicianId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["technicianId"],
        message:
          "technicianId is required for technician_unavailable disruptions",
      });
    }
  });

const optimizationSchema = z.object({
  includeAssigned: z.boolean().optional(),
  reason: z.string().min(3).max(500).optional(),
  actor: z.string().min(1).optional(),
  async: z.boolean().optional(),
});

const autoDisruptionRunSchema = z.object({
  maxSignals: z.number().int().min(1).max(50).optional(),
  actor: z.string().min(1).optional(),
  async: z.boolean().optional(),
});

const automationCycleSchema = z.object({
  runAutoDisruption: z.boolean().optional(),
  runOptimization: z.boolean().optional(),
  maxSignals: z.number().int().min(1).max(50).optional(),
  includeAssigned: z.boolean().optional(),
  actor: z.string().min(1).optional(),
  async: z.boolean().optional(),
});

const intelligenceConfirmSchema = z.object({
  runId: z.string().min(1),
  action: z.enum(["auto_dispatch", "parts_order", "customer_eta_update"]),
  actor: z.string().min(1).optional(),
});

const mobileOperationSchema = z.object({
  clientOperationId: z.string().min(1),
  type: z.enum(["start_job", "complete_job", "update_checklist", "add_proof"]),
  payload: z.record(z.string(), z.unknown()),
});

const mobileSyncSchema = z.object({
  operations: z.array(mobileOperationSchema).min(1).max(100),
});

const manualOverrideSchema = z.object({
  actor: z.string().min(1),
  reason: z.string().min(1),
  changes: z.record(z.string(), z.unknown()).optional(),
});

const invoiceCreateSchema = z.object({
  taxRatePercent: z.number().nonnegative().max(100).optional(),
  calloutFeeCents: z.number().int().nonnegative().optional(),
});

const unassignSchema = z.object({
  jobId: z.string().min(1),
  actor: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
  expectedVersion: z.number().int().positive().optional(),
});

function validationError(c: Context, issues: unknown) {
  return c.json(
    {
      error: "Invalid request payload",
      issues,
    },
    400,
  );
}

function notEnabled(c: Context, feature: string) {
  return c.json({ error: `${feature} is disabled by feature flag` }, 503);
}

function enforceRole(
  c: Context,
  roles: Array<"technician" | "dispatcher" | "manager" | "admin">,
) {
  const forbidden = ensureRole(c, roles);

  if (forbidden) {
    return forbidden;
  }

  return null;
}

function parseLimit(input: string | undefined, fallback = 50, max = 200) {
  const parsed = Number.parseInt(input ?? String(fallback), 10);

  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(1, parsed));
}

function parseFloatEnv(
  name: string,
  fallback: number,
  min: number,
  max: number,
) {
  const raw = process.env[name];

  if (raw === undefined) {
    return fallback;
  }

  const parsed = Number.parseFloat(raw);

  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
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

function intelligenceGuardrailThreshold() {
  return parseFloatEnv(
    "INTELLIGENCE_AUTO_ACTION_MIN_CONFIDENCE",
    0.72,
    0.3,
    0.99,
  );
}

function integrationUnavailable(
  c: Context,
  integration: "crm" | "invoicing",
  error: unknown,
) {
  const requestId = (c.get("requestId") as string | undefined) ?? null;

  if (process.env.NODE_ENV !== "test" && process.env.VITEST !== "true") {
    console.warn(
      `[integration] ${JSON.stringify({
        integration,
        requestId,
        method: c.req.method,
        path: c.req.path,
        message: String(error),
      })}`,
    );
  }

  return c.json(
    {
      error: `${integration.toUpperCase()} integration unavailable`,
      integration,
      requestId,
    },
    502,
  );
}

const lastAutoDisruptionSweepAt = new Map<string, number>();

async function runAutoDisruptionSweep(
  actor: string,
  tenantId: string,
  maxSignals = 10,
) {
  const provider = getDisruptionFeedProvider();
  const signals = await provider.pollSignals({
    jobs: listJobs(),
    technicians: listTechnicians(),
  });
  const processed = [];

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

  lastAutoDisruptionSweepAt.set(tenantId, Date.now());

  return {
    detectedSignals: signals.length,
    processedSignals: processed.length,
    processed,
  };
}

fieldRoutes.get("/dispatch-board", async (c) => {
  const auth = getAuth(c);

  if (featureFlags.autoDisruptionMonitor) {
    const cooldownMs = parseLimit(
      process.env.AUTO_DISRUPTION_COOLDOWN_MS,
      30_000,
      300_000,
    );
    const now = Date.now();
    const lastSweep = lastAutoDisruptionSweepAt.get(auth.tenantId) ?? 0;

    if (now - lastSweep >= cooldownMs) {
      try {
        await runAutoDisruptionSweep(auth.userId, auth.tenantId, 5);
      } catch {
        c.header("x-auto-disruption-warning", "sweep-failed");
      }
    }
  }

  return c.json(getDispatchBoard());
});

fieldRoutes.get("/dispatch-board/stream", (c) => {
  if (!featureFlags.realtimeBoard) {
    return notEnabled(c, "realtimeBoard");
  }

  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = () => {
        const payload = JSON.stringify({
          type: "dispatch-board",
          timestamp: new Date().toISOString(),
          board: getDispatchBoard(),
        });
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
      };

      send();
      timer = setInterval(send, 5000);
    },
    cancel() {
      if (timer) {
        clearInterval(timer);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
});

fieldRoutes.post("/dispatch/disruptions", async (c) => {
  const forbidden = enforceRole(c, ["dispatcher", "manager", "admin"]);

  if (forbidden) {
    return forbidden;
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = disruptionSchema.safeParse(body);

  if (!parsed.success) {
    return validationError(c, parsed.error.issues);
  }

  const auth = getAuth(c);
  const payload = {
    ...parsed.data,
    actor: parsed.data.actor ?? auth.userId,
  };
  const idempotencyScope = featureFlags.idempotency
    ? idempotencyKey(c, "dispatch-disruption", payload)
    : null;

  if (idempotencyScope) {
    const replay = await replayIdempotent(c, idempotencyScope);

    if (replay) {
      return replay;
    }
  }

  const result = handleDispatchDisruption(payload);

  if (featureFlags.crmIntegration && result.reassignedJobIds.length > 0) {
    for (const jobId of result.reassignedJobIds) {
      const job = getJobById(jobId);

      if (!job) {
        continue;
      }

      try {
        const sync = await syncCrmWorkOrderEvent(job);
        if (sync.queued) {
          c.header("x-integration-outbox", sync.outboxEntryId ?? "queued");
        }
      } catch {
        c.header("x-integration-warning", "crm-sync-failed");
        break;
      }
    }
  }

  if (idempotencyScope) {
    await storeIdempotent(idempotencyScope, 200, result);
  }

  return c.json(result);
});

fieldRoutes.post("/dispatch/disruptions/auto-run", async (c) => {
  const forbidden = enforceRole(c, ["dispatcher", "manager", "admin"]);

  if (forbidden) {
    return forbidden;
  }

  if (!featureFlags.autoDisruptionMonitor) {
    return notEnabled(c, "autoDisruptionMonitor");
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = autoDisruptionRunSchema.safeParse(body);

  if (!parsed.success) {
    return validationError(c, parsed.error.issues);
  }

  const auth = getAuth(c);

  if (parsed.data.async) {
    const job = await enqueueBackgroundJob({
      type: "dispatch_auto_disruption",
      tenantId: auth.tenantId,
      payload: {
        actor: parsed.data.actor ?? auth.userId,
        maxSignals: parsed.data.maxSignals ?? 10,
      },
    });

    return c.json(
      {
        queued: true,
        job,
      },
      202,
    );
  }

  try {
    const result = await runAutoDisruptionSweep(
      parsed.data.actor ?? auth.userId,
      auth.tenantId,
      parsed.data.maxSignals ?? 10,
    );
    return c.json(result);
  } catch (error) {
    return c.json(
      {
        error: "Auto disruption sweep failed",
        detail: String(error),
      },
      502,
    );
  }
});

fieldRoutes.post("/dispatch/optimize", async (c) => {
  const forbidden = enforceRole(c, ["dispatcher", "manager", "admin"]);

  if (forbidden) {
    return forbidden;
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = optimizationSchema.safeParse(body);

  if (!parsed.success) {
    return validationError(c, parsed.error.issues);
  }

  const auth = getAuth(c);

  if (parsed.data.async) {
    const job = await enqueueBackgroundJob({
      type: "dispatch_optimize",
      tenantId: auth.tenantId,
      payload: {
        includeAssigned: parsed.data.includeAssigned,
        reason: parsed.data.reason,
        actor: parsed.data.actor ?? auth.userId,
      },
    });

    return c.json(
      {
        queued: true,
        job,
      },
      202,
    );
  }

  const result = optimizeDispatchAssignments({
    includeAssigned: parsed.data.includeAssigned,
    reason: parsed.data.reason,
    actor: parsed.data.actor ?? auth.userId,
  });

  return c.json(result);
});

fieldRoutes.post("/ops/automation/run-cycle", async (c) => {
  const forbidden = enforceRole(c, ["manager", "admin"]);

  if (forbidden) {
    return forbidden;
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = automationCycleSchema.safeParse(body);

  if (!parsed.success) {
    return validationError(c, parsed.error.issues);
  }

  const auth = getAuth(c);
  const actor = parsed.data.actor ?? auth.userId;
  const runAutoDisruption = parsed.data.runAutoDisruption ?? true;
  const runOptimization = parsed.data.runOptimization ?? true;

  if (parsed.data.async) {
    const jobs = [];

    if (runAutoDisruption && featureFlags.autoDisruptionMonitor) {
      jobs.push(
        await enqueueBackgroundJob({
          type: "dispatch_auto_disruption",
          tenantId: auth.tenantId,
          payload: {
            actor,
            maxSignals: parsed.data.maxSignals ?? 10,
          },
        }),
      );
    }

    if (runOptimization) {
      jobs.push(
        await enqueueBackgroundJob({
          type: "dispatch_optimize",
          tenantId: auth.tenantId,
          payload: {
            includeAssigned: parsed.data.includeAssigned ?? true,
            reason: "automation cycle optimization",
            actor,
          },
        }),
      );
    }

    if (featureFlags.integrationOutbox) {
      jobs.push(
        await enqueueBackgroundJob({
          type: "integration_outbox_flush",
          tenantId: auth.tenantId,
          payload: {
            maxBatch: 25,
          },
        }),
      );
    }

    return c.json(
      {
        queued: true,
        jobs,
      },
      202,
    );
  }

  let disruption = null;
  let optimization = null;

  if (runAutoDisruption && featureFlags.autoDisruptionMonitor) {
    try {
      disruption = await runAutoDisruptionSweep(
        actor,
        auth.tenantId,
        parsed.data.maxSignals ?? 10,
      );
    } catch (error) {
      disruption = {
        error: "Auto disruption sweep failed",
        detail: String(error),
      };
    }
  }

  if (runOptimization) {
    optimization = optimizeDispatchAssignments({
      includeAssigned: parsed.data.includeAssigned ?? true,
      reason: "automation cycle optimization",
      actor,
    });
  }

  const driftAlerts = getWorkOrderIntelligenceDriftAlerts({
    windowHours: parseIntEnv("INTELLIGENCE_DRIFT_WINDOW_HOURS", 24, 1, 720),
    minSampleCount: parseIntEnv("INTELLIGENCE_DRIFT_MIN_SAMPLES", 3, 1, 1000),
    maxMaeMinutes: parseFloatEnv(
      "INTELLIGENCE_DRIFT_MAX_MAE_MINUTES",
      35,
      5,
      480,
    ),
    minWithin15Rate: parseFloatEnv(
      "INTELLIGENCE_DRIFT_MIN_WITHIN15_RATE",
      0.55,
      0.05,
      1,
    ),
  });
  const metrics = getObservabilitySnapshot({
    windowMinutes: 120,
    tenantId: auth.tenantId,
  });

  return c.json({
    executedAt: new Date().toISOString(),
    actor,
    runAutoDisruption,
    runOptimization,
    disruption,
    optimization,
    driftAlerts,
    metrics,
  });
});

fieldRoutes.post("/jobs/assign", async (c) => {
  const forbidden = enforceRole(c, ["dispatcher", "manager", "admin"]);

  if (forbidden) {
    return forbidden;
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = assignJobSchema.safeParse(body);

  if (!parsed.success) {
    return validationError(c, parsed.error.issues);
  }

  const idempotencyScope = featureFlags.idempotency
    ? idempotencyKey(c, "assign-job", parsed.data)
    : null;

  if (idempotencyScope) {
    const replay = await replayIdempotent(c, idempotencyScope);

    if (replay) {
      return replay;
    }
  }

  const auth = getAuth(c);
  const result = assignJob({
    ...parsed.data,
    actor: parsed.data.actor ?? auth.userId,
  });
  if ("assigned" in result && result.assigned) {
    const job = getJobById(result.jobId);

    if (job && featureFlags.crmIntegration) {
      try {
        const sync = await syncCrmWorkOrderEvent(job);
        if (sync.queued) {
          c.header("x-integration-outbox", sync.outboxEntryId ?? "queued");
        }
      } catch {
        c.header("x-integration-warning", "crm-sync-failed");
      }
    }
  }
  const status = "assigned" in result && result.assigned ? 202 : 409;

  if (idempotencyScope) {
    await storeIdempotent(idempotencyScope, status, result);
  }

  return c.json(result, status);
});

fieldRoutes.post("/jobs/reassign", async (c) => {
  const forbidden = enforceRole(c, ["dispatcher", "manager", "admin"]);

  if (forbidden) {
    return forbidden;
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = reassignSchema.safeParse(body);

  if (!parsed.success) {
    return validationError(c, parsed.error.issues);
  }

  const idempotencyScope = featureFlags.idempotency
    ? idempotencyKey(c, "reassign-job", parsed.data)
    : null;

  if (idempotencyScope) {
    const replay = await replayIdempotent(c, idempotencyScope);

    if (replay) {
      return replay;
    }
  }

  const auth = getAuth(c);
  const result = reassignJob({
    ...parsed.data,
    actor: parsed.data.actor ?? auth.userId,
  });
  if ("assigned" in result && result.assigned) {
    const job = getJobById(result.jobId);

    if (job && featureFlags.crmIntegration) {
      try {
        const sync = await syncCrmWorkOrderEvent(job);
        if (sync.queued) {
          c.header("x-integration-outbox", sync.outboxEntryId ?? "queued");
        }
      } catch {
        c.header("x-integration-warning", "crm-sync-failed");
      }
    }
  }
  const status = "assigned" in result && result.assigned ? 202 : 409;

  if (idempotencyScope) {
    await storeIdempotent(idempotencyScope, status, result);
  }

  return c.json(result, status);
});

fieldRoutes.post("/jobs/unassign", async (c) => {
  const forbidden = enforceRole(c, ["dispatcher", "manager", "admin"]);

  if (forbidden) {
    return forbidden;
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = unassignSchema.safeParse(body);

  if (!parsed.success) {
    return validationError(c, parsed.error.issues);
  }

  const idempotencyScope = featureFlags.idempotency
    ? idempotencyKey(c, "unassign-job", parsed.data)
    : null;

  if (idempotencyScope) {
    const replay = await replayIdempotent(c, idempotencyScope);

    if (replay) {
      return replay;
    }
  }

  const auth = getAuth(c);
  const result = unassignJob({
    ...parsed.data,
    actor: parsed.data.actor ?? auth.userId,
  });
  const status = result.unassigned ? 200 : 409;

  if (idempotencyScope) {
    await storeIdempotent(idempotencyScope, status, result);
  }

  return c.json(result, status);
});

fieldRoutes.get("/jobs/unassigned", (c) => {
  return c.json({ queue: getUnassignedQueue() });
});

fieldRoutes.post("/technicians/:technicianId/shifts", async (c) => {
  const forbidden = enforceRole(c, ["dispatcher", "manager", "admin"]);

  if (forbidden) {
    return forbidden;
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = shiftSchema.safeParse(body);

  if (!parsed.success) {
    return validationError(c, parsed.error.issues);
  }

  const auth = getAuth(c);
  const payload = {
    technicianId: c.req.param("technicianId"),
    ...parsed.data,
    actor: parsed.data.actor ?? auth.userId,
  };
  const idempotencyScope = featureFlags.idempotency
    ? idempotencyKey(c, "update-shift", payload)
    : null;

  if (idempotencyScope) {
    const replay = await replayIdempotent(c, idempotencyScope);

    if (replay) {
      return replay;
    }
  }

  const result = updateTechnicianShift(payload);
  const status = result.updated ? 200 : 404;

  if (idempotencyScope) {
    await storeIdempotent(idempotencyScope, status, result);
  }

  return c.json(result, status);
});

fieldRoutes.post("/routes/plan", async (c) => {
  const forbidden = enforceRole(c, ["dispatcher", "manager", "admin"]);

  if (forbidden) {
    return forbidden;
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = routePlanSchema.safeParse(body);

  if (!parsed.success) {
    return validationError(c, parsed.error.issues);
  }

  const payload = {
    technicianId: parsed.data.technicianId,
    date: parsed.data.date,
    triggeredBy: "manual",
    trafficLevel: parsed.data.trafficLevel,
  } as const;
  const idempotencyScope = featureFlags.idempotency
    ? idempotencyKey(c, "route-plan", payload)
    : null;

  if (idempotencyScope) {
    const replay = await replayIdempotent(c, idempotencyScope);

    if (replay) {
      return replay;
    }
  }

  const plan = generateRoutePlan(payload);

  if (!plan) {
    return c.json({ error: "Technician not found" }, 404);
  }

  if (idempotencyScope) {
    await storeIdempotent(idempotencyScope, 201, plan);
  }

  return c.json(plan, 201);
});

fieldRoutes.post("/routes/replan", async (c) => {
  const forbidden = enforceRole(c, ["dispatcher", "manager", "admin"]);

  if (forbidden) {
    return forbidden;
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = routeReplanSchema.safeParse(body);

  if (!parsed.success) {
    return validationError(c, parsed.error.issues);
  }

  const idempotencyScope = featureFlags.idempotency
    ? idempotencyKey(c, "route-replan", parsed.data)
    : null;

  if (idempotencyScope) {
    const replay = await replayIdempotent(c, idempotencyScope);

    if (replay) {
      return replay;
    }
  }

  const result = triggerTrafficAwareReplanning(parsed.data);

  if (idempotencyScope) {
    await storeIdempotent(idempotencyScope, 200, result);
  }

  return c.json(result);
});

fieldRoutes.get("/routes/daily", (c) => {
  const date = c.req.query("date");
  return c.json({ routes: getRoutePlans(date) });
});

fieldRoutes.get("/jobs/:jobId/checklist", (c) => {
  const checklist = getJobChecklist(c.req.param("jobId"));

  if (!checklist) {
    return c.json({ error: "Job not found" }, 404);
  }

  return c.json({ checklist });
});

fieldRoutes.post("/jobs/:jobId/checklist", async (c) => {
  const forbidden = enforceRole(c, [
    "technician",
    "dispatcher",
    "manager",
    "admin",
  ]);

  if (forbidden) {
    return forbidden;
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = checklistUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return validationError(c, parsed.error.issues);
  }

  const payload = { jobId: c.req.param("jobId"), ...parsed.data };
  const idempotencyScope = featureFlags.idempotency
    ? idempotencyKey(c, "job-checklist", payload)
    : null;

  if (idempotencyScope) {
    const replay = await replayIdempotent(c, idempotencyScope);

    if (replay) {
      return replay;
    }
  }

  const checklist = updateJobChecklist(payload);

  if (!checklist) {
    return c.json({ error: "Job not found" }, 404);
  }

  const responseBody = { checklist };

  if (idempotencyScope) {
    await storeIdempotent(idempotencyScope, 200, responseBody);
  }

  return c.json(responseBody);
});

fieldRoutes.post("/jobs/:jobId/proof-of-service", async (c) => {
  const forbidden = enforceRole(c, [
    "technician",
    "dispatcher",
    "manager",
    "admin",
  ]);

  if (forbidden) {
    return forbidden;
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = proofSchema.safeParse(body);

  if (!parsed.success) {
    return validationError(c, parsed.error.issues);
  }

  const payload = {
    jobId: c.req.param("jobId"),
    ...parsed.data,
  };
  const idempotencyScope = featureFlags.idempotency
    ? idempotencyKey(c, "proof-of-service", payload)
    : null;

  if (idempotencyScope) {
    const replay = await replayIdempotent(c, idempotencyScope);

    if (replay) {
      return replay;
    }
  }

  const proof = addProofOfService(payload);

  if (!proof) {
    return c.json({ error: "Job not found" }, 404);
  }

  const responseBody = { proof };

  if (idempotencyScope) {
    await storeIdempotent(idempotencyScope, 201, responseBody);
  }

  return c.json(responseBody, 201);
});

fieldRoutes.post("/jobs/:jobId/intelligence", async (c) => {
  const forbidden = enforceRole(c, [
    "technician",
    "dispatcher",
    "manager",
    "admin",
  ]);

  if (forbidden) {
    return forbidden;
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = jobIntelligenceSchema.safeParse(body);

  if (!parsed.success) {
    return validationError(c, parsed.error.issues);
  }

  const jobId = c.req.param("jobId");
  const job = getJobById(jobId);

  if (!job) {
    return c.json({ error: "Job not found" }, 404);
  }

  let result = null;

  try {
    const provider = getFieldIntelligenceProvider();
    const providerResult = await provider.generateWorkOrderIntelligence({
      jobId: job.id,
      title: job.title,
      requiredSkills: job.requiredSkills,
      estimatedMinutes: job.estimatedMinutes,
      priority: job.priority,
      symptoms: parsed.data.symptoms,
      notes: parsed.data.notes,
    });

    if (providerResult) {
      result = storeExternalWorkOrderIntelligence({
        jobId: job.id,
        symptoms: parsed.data.symptoms,
        notes: parsed.data.notes,
        result: providerResult,
      });
    }
  } catch {
    c.header("x-intelligence-provider-warning", "provider-fallback");
  }

  if (!result) {
    result = generateWorkOrderIntelligence({
      jobId: job.id,
      symptoms: parsed.data.symptoms,
      notes: parsed.data.notes,
    });
  }

  if (!result) {
    return c.json({ error: "Unable to generate intelligence output" }, 500);
  }

  const minConfidence = intelligenceGuardrailThreshold();
  const requiresConfirmation = result.confidence < minConfidence;

  if (requiresConfirmation) {
    c.header("x-intelligence-guardrail", "recommendation-only");
  }

  return c.json({
    result,
    guardrail: {
      minimumConfidence: minConfidence,
      requiresConfirmation,
      mode: requiresConfirmation ? "recommendation_only" : "automation_allowed",
    },
  });
});

fieldRoutes.post("/jobs/:jobId/assist/briefing", async (c) => {
  const forbidden = enforceRole(c, [
    "technician",
    "dispatcher",
    "manager",
    "admin",
  ]);

  if (forbidden) {
    return forbidden;
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = technicianAssistSchema.safeParse(body);

  if (!parsed.success) {
    return validationError(c, parsed.error.issues);
  }

  const jobId = c.req.param("jobId");
  const job = getJobById(jobId);

  if (!job) {
    return c.json({ error: "Job not found" }, 404);
  }

  let result = null;

  try {
    const provider = getFieldIntelligenceProvider();
    const providerResult = await provider.generateTechnicianAssistBriefing({
      jobId: job.id,
      status: job.status,
      requiredSkills: job.requiredSkills,
      checklist: job.checklist,
      noteContext: parsed.data.noteContext,
    });

    if (providerResult) {
      result = storeExternalTechnicianAssistBriefing({
        jobId: job.id,
        result: providerResult,
      });
    }
  } catch {
    c.header("x-intelligence-provider-warning", "provider-fallback");
  }

  if (!result) {
    result = generateTechnicianAssistBriefing({
      jobId: job.id,
      noteContext: parsed.data.noteContext,
    });
  }

  return c.json({ result });
});

fieldRoutes.get("/intelligence/history", (c) => {
  const forbidden = enforceRole(c, [
    "technician",
    "dispatcher",
    "manager",
    "admin",
  ]);

  if (forbidden) {
    return forbidden;
  }

  const limit = parseLimit(c.req.query("limit"), 50, 500);
  const jobId = c.req.query("jobId");

  return c.json({
    workOrderRuns: getWorkOrderIntelligenceHistory({ limit, jobId }),
    assistBriefings: getTechnicianAssistHistory({ limit, jobId }),
  });
});

fieldRoutes.get("/intelligence/accuracy", (c) => {
  const forbidden = enforceRole(c, ["dispatcher", "manager", "admin"]);

  if (forbidden) {
    return forbidden;
  }

  const jobId = c.req.query("jobId");
  return c.json({ accuracy: getWorkOrderIntelligenceAccuracy({ jobId }) });
});

fieldRoutes.get("/intelligence/quality-report", (c) => {
  const forbidden = enforceRole(c, ["manager", "admin"]);

  if (forbidden) {
    return forbidden;
  }

  const windowHours = parseLimit(c.req.query("windowHours"), 24, 720);
  return c.json({
    report: getWorkOrderIntelligenceQualityReport({ windowHours }),
  });
});

fieldRoutes.get("/intelligence/drift-alerts", (c) => {
  const forbidden = enforceRole(c, ["manager", "admin"]);

  if (forbidden) {
    return forbidden;
  }

  const windowHours = parseLimit(c.req.query("windowHours"), 24, 720);
  const minSampleCount = parseLimit(c.req.query("minSampleCount"), 3, 1000);
  const maxMaeMinutes = parseFloatEnv(
    "INTELLIGENCE_DRIFT_MAX_MAE_MINUTES",
    35,
    5,
    480,
  );
  const minWithin15Rate = parseFloatEnv(
    "INTELLIGENCE_DRIFT_MIN_WITHIN15_RATE",
    0.55,
    0.05,
    1,
  );

  return c.json({
    alerts: getWorkOrderIntelligenceDriftAlerts({
      windowHours,
      minSampleCount,
      maxMaeMinutes,
      minWithin15Rate,
    }),
  });
});

fieldRoutes.post("/jobs/:jobId/intelligence/confirm", async (c) => {
  const forbidden = enforceRole(c, ["dispatcher", "manager", "admin"]);

  if (forbidden) {
    return forbidden;
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = intelligenceConfirmSchema.safeParse(body);

  if (!parsed.success) {
    return validationError(c, parsed.error.issues);
  }

  const jobId = c.req.param("jobId");
  const run = getWorkOrderIntelligenceHistory({ jobId, limit: 200 }).find(
    (item) => item.id === parsed.data.runId,
  );

  if (!run) {
    return c.json({ error: "Intelligence run not found" }, 404);
  }

  const minConfidence = intelligenceGuardrailThreshold();
  const auth = getAuth(c);
  const actor = parsed.data.actor ?? auth.userId;
  const bypassedGuardrail = run.confidence < minConfidence;

  recordManualOverride({
    jobId,
    actor,
    reason: `Intelligence action confirmed: ${parsed.data.action}`,
    changes: {
      runId: run.id,
      runConfidence: run.confidence,
      guardrailThreshold: minConfidence,
      bypassedGuardrail,
    },
  });

  return c.json({
    confirmed: true,
    runId: run.id,
    action: parsed.data.action,
    bypassedGuardrail,
  });
});

fieldRoutes.post("/jobs/:jobId/start", async (c) => {
  const forbidden = enforceRole(c, [
    "technician",
    "dispatcher",
    "manager",
    "admin",
  ]);

  if (forbidden) {
    return forbidden;
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = startJobSchema.safeParse(body);

  if (!parsed.success) {
    return validationError(c, parsed.error.issues);
  }

  const auth = getAuth(c);
  const payload = {
    jobId: c.req.param("jobId"),
    ...parsed.data,
    actor: parsed.data.actor ?? auth.userId,
  };
  const idempotencyScope = featureFlags.idempotency
    ? idempotencyKey(c, "start-job", payload)
    : null;

  if (idempotencyScope) {
    const replay = await replayIdempotent(c, idempotencyScope);

    if (replay) {
      return replay;
    }
  }

  const result = startJob(payload);
  if (result.started && "job" in result && featureFlags.crmIntegration) {
    try {
      const sync = await syncCrmWorkOrderEvent(result.job);
      if (sync.queued) {
        c.header("x-integration-outbox", sync.outboxEntryId ?? "queued");
      }
    } catch {
      c.header("x-integration-warning", "crm-sync-failed");
    }
  }
  const status = result.started ? 200 : 409;

  if (idempotencyScope) {
    await storeIdempotent(idempotencyScope, status, result);
  }

  return c.json(result, status);
});

fieldRoutes.post("/jobs/:jobId/complete", async (c) => {
  const forbidden = enforceRole(c, [
    "technician",
    "dispatcher",
    "manager",
    "admin",
  ]);

  if (forbidden) {
    return forbidden;
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = completeJobSchema.safeParse(body);

  if (!parsed.success) {
    return validationError(c, parsed.error.issues);
  }

  const auth = getAuth(c);
  const payload = {
    jobId: c.req.param("jobId"),
    ...parsed.data,
    actor: parsed.data.actor ?? auth.userId,
  };
  const idempotencyScope = featureFlags.idempotency
    ? idempotencyKey(c, "complete-job", payload)
    : null;

  if (idempotencyScope) {
    const replay = await replayIdempotent(c, idempotencyScope);

    if (replay) {
      return replay;
    }
  }

  const result = completeJob(payload);
  if (result.completed && "job" in result && featureFlags.crmIntegration) {
    try {
      const sync = await syncCrmWorkOrderEvent(result.job);
      if (sync.queued) {
        c.header("x-integration-outbox", sync.outboxEntryId ?? "queued");
      }
    } catch {
      c.header("x-integration-warning", "crm-sync-failed");
    }
  }
  const status = result.completed ? 200 : 409;

  if (idempotencyScope) {
    await storeIdempotent(idempotencyScope, status, result);
  }

  return c.json(result, status);
});

fieldRoutes.post("/mobile/sync", async (c) => {
  const forbidden = enforceRole(c, [
    "technician",
    "dispatcher",
    "manager",
    "admin",
  ]);

  if (forbidden) {
    return forbidden;
  }

  if (!featureFlags.mobileSync) {
    return notEnabled(c, "mobileSync");
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = mobileSyncSchema.safeParse(body);

  if (!parsed.success) {
    return validationError(c, parsed.error.issues);
  }

  const auth = getAuth(c);
  const results: Array<{
    clientOperationId: string;
    type: string;
    ok: boolean;
    status: number;
    retryable: boolean;
    body: unknown;
  }> = [];

  for (const operation of parsed.data.operations) {
    try {
      if (operation.type === "start_job") {
        const payload = z
          .object({
            jobId: z.string().min(1),
            expectedVersion: z.number().int().positive().optional(),
          })
          .parse(operation.payload);
        const result = startJob({
          jobId: payload.jobId,
          expectedVersion: payload.expectedVersion,
          actor: auth.userId,
        });
        results.push({
          clientOperationId: operation.clientOperationId,
          type: operation.type,
          ok: result.started,
          status: result.started ? 200 : 409,
          retryable: false,
          body: result,
        });
        continue;
      }

      if (operation.type === "complete_job") {
        const payload = z
          .object({
            jobId: z.string().min(1),
            completionNotes: z.string().min(1).optional(),
            firstTimeFix: z.boolean().optional(),
            expectedVersion: z.number().int().positive().optional(),
          })
          .parse(operation.payload);
        const result = completeJob({
          jobId: payload.jobId,
          completionNotes: payload.completionNotes,
          firstTimeFix: payload.firstTimeFix,
          expectedVersion: payload.expectedVersion,
          actor: auth.userId,
        });
        results.push({
          clientOperationId: operation.clientOperationId,
          type: operation.type,
          ok: result.completed,
          status: result.completed ? 200 : 409,
          retryable: false,
          body: result,
        });
        continue;
      }

      if (operation.type === "update_checklist") {
        const payload = z
          .object({
            jobId: z.string().min(1),
            items: z
              .array(
                z.object({
                  id: z.string().min(1),
                  done: z.boolean(),
                }),
              )
              .min(1),
          })
          .parse(operation.payload);
        const checklist = updateJobChecklist({
          jobId: payload.jobId,
          items: payload.items,
        });
        results.push({
          clientOperationId: operation.clientOperationId,
          type: operation.type,
          ok: checklist !== null,
          status: checklist ? 200 : 404,
          retryable: false,
          body: checklist ? { checklist } : { error: "Job not found" },
        });
        continue;
      }

      if (operation.type === "add_proof") {
        const payload = z
          .object({
            jobId: z.string().min(1),
            proofUrl: z.string().url(),
            note: z.string().min(1).optional(),
          })
          .parse(operation.payload);
        const proof = addProofOfService({
          jobId: payload.jobId,
          proofUrl: payload.proofUrl,
          note: payload.note,
        });
        results.push({
          clientOperationId: operation.clientOperationId,
          type: operation.type,
          ok: proof !== null,
          status: proof ? 201 : 404,
          retryable: false,
          body: proof ? { proof } : { error: "Job not found" },
        });
        continue;
      }

      results.push({
        clientOperationId: operation.clientOperationId,
        type: operation.type,
        ok: false,
        status: 400,
        retryable: false,
        body: { error: "Unsupported operation type" },
      });
    } catch (error) {
      results.push({
        clientOperationId: operation.clientOperationId,
        type: operation.type,
        ok: false,
        status: 400,
        retryable: false,
        body: { error: "Invalid operation payload", detail: String(error) },
      });
    }
  }

  return c.json({
    syncedAt: new Date().toISOString(),
    total: results.length,
    successCount: results.filter((item) => item.ok).length,
    failedCount: results.filter((item) => !item.ok).length,
    results,
  });
});

fieldRoutes.get("/alerts/sla-breaches", (c) => {
  return c.json({ breaches: evaluateSlaBreaches() });
});

fieldRoutes.get("/analytics/kpis", (c) => {
  const forbidden = enforceRole(c, ["manager", "admin"]);

  if (forbidden) {
    return forbidden;
  }

  return c.json({ kpis: getOperationalKpis() });
});

fieldRoutes.get("/observability/metrics", (c) => {
  const forbidden = enforceRole(c, ["manager", "admin"]);

  if (forbidden) {
    return forbidden;
  }

  if (!featureFlags.observabilityMetrics) {
    return notEnabled(c, "observabilityMetrics");
  }

  const auth = getAuth(c);
  const windowMinutes = parseLimit(c.req.query("windowMinutes"), 60, 1440);
  return c.json({
    metrics: getObservabilitySnapshot({
      windowMinutes,
      tenantId: auth.tenantId,
    }),
  });
});

fieldRoutes.post("/maintenance/risk-score", async (c) => {
  const forbidden = enforceRole(c, ["manager", "admin"]);

  if (forbidden) {
    return forbidden;
  }

  if (!featureFlags.predictiveMaintenance) {
    return notEnabled(c, "predictiveMaintenance");
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = maintenanceRiskSchema.safeParse(body);

  if (!parsed.success) {
    return validationError(c, parsed.error.issues);
  }

  return c.json({ result: assessMaintenanceRisk(parsed.data) });
});

fieldRoutes.post("/jobs/:jobId/manual-override", async (c) => {
  const forbidden = enforceRole(c, ["dispatcher", "manager", "admin"]);

  if (forbidden) {
    return forbidden;
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = manualOverrideSchema.safeParse(body);

  if (!parsed.success) {
    return validationError(c, parsed.error.issues);
  }

  const payload = {
    jobId: c.req.param("jobId"),
    actor: parsed.data.actor,
    reason: parsed.data.reason,
    changes: parsed.data.changes,
  };
  const idempotencyScope = featureFlags.idempotency
    ? idempotencyKey(c, "manual-override", payload)
    : null;

  if (idempotencyScope) {
    const replay = await replayIdempotent(c, idempotencyScope);

    if (replay) {
      return replay;
    }
  }

  const result = recordManualOverride(payload);
  const status = result.recorded ? 201 : 404;

  if (idempotencyScope) {
    await storeIdempotent(idempotencyScope, status, result);
  }

  return c.json(result, status);
});

fieldRoutes.get("/audit-trail", (c) => {
  const forbidden = enforceRole(c, ["manager", "admin"]);

  if (forbidden) {
    return forbidden;
  }

  const limit = parseLimit(c.req.query("limit"), 50, 200);
  return c.json({ entries: getAuditTrail(limit) });
});

fieldRoutes.get("/ops/jobs", async (c) => {
  const forbidden = enforceRole(c, ["manager", "admin"]);

  if (forbidden) {
    return forbidden;
  }

  const auth = getAuth(c);
  const limit = parseLimit(c.req.query("limit"), 50, 200);
  const jobs = await listBackgroundJobs(limit, auth.tenantId);
  return c.json({ jobs });
});

fieldRoutes.get("/ops/jobs/:jobId", async (c) => {
  const forbidden = enforceRole(c, ["manager", "admin"]);

  if (forbidden) {
    return forbidden;
  }

  const auth = getAuth(c);
  const job = await getBackgroundJob(c.req.param("jobId"), auth.tenantId);

  if (!job) {
    return c.json({ error: "Background job not found" }, 404);
  }

  return c.json({ job });
});

fieldRoutes.get("/integrations/outbox", async (c) => {
  const forbidden = enforceRole(c, ["manager", "admin"]);

  if (forbidden) {
    return forbidden;
  }

  if (!featureFlags.integrationOutbox) {
    return notEnabled(c, "integrationOutbox");
  }

  const limit = parseLimit(c.req.query("limit"), 50, 500);
  const status = c.req.query("status");
  const parsedStatus =
    status === "pending" ||
    status === "processing" ||
    status === "delivered" ||
    status === "dead_letter"
      ? status
      : undefined;

  const [summary, entries] = await Promise.all([
    getIntegrationOutboxSummary(),
    listIntegrationOutboxEntries({
      limit,
      status: parsedStatus,
    }),
  ]);

  return c.json({ summary, entries });
});

fieldRoutes.post("/integrations/outbox/flush", async (c) => {
  const forbidden = enforceRole(c, ["manager", "admin"]);

  if (forbidden) {
    return forbidden;
  }

  if (!featureFlags.integrationOutbox) {
    return notEnabled(c, "integrationOutbox");
  }

  const auth = getAuth(c);
  const body = await c.req.json().catch(() => ({}));
  const parsed = z
    .object({
      maxBatch: z.number().int().min(1).max(200).optional(),
      async: z.boolean().optional(),
    })
    .safeParse(body);

  if (!parsed.success) {
    return validationError(c, parsed.error.issues);
  }

  if (parsed.data.async) {
    const job = await enqueueBackgroundJob({
      type: "integration_outbox_flush",
      tenantId: auth.tenantId,
      payload: {
        maxBatch: parsed.data.maxBatch ?? 25,
      },
    });

    return c.json(
      {
        queued: true,
        job,
      },
      202,
    );
  }

  const result = await flushIntegrationOutbox({
    maxBatch: parsed.data.maxBatch ?? 25,
  });
  const summary = await getIntegrationOutboxSummary();
  return c.json({ result, summary });
});

fieldRoutes.post("/integrations/outbox/requeue", async (c) => {
  const forbidden = enforceRole(c, ["manager", "admin"]);

  if (forbidden) {
    return forbidden;
  }

  if (!featureFlags.integrationOutbox) {
    return notEnabled(c, "integrationOutbox");
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = z
    .object({
      ids: z.array(z.string().min(1)).max(500).optional(),
      limit: z.number().int().min(1).max(500).optional(),
    })
    .safeParse(body);

  if (!parsed.success) {
    return validationError(c, parsed.error.issues);
  }

  const result = await requeueIntegrationOutboxDeadLetters({
    ids: parsed.data.ids,
    limit: parsed.data.limit,
  });
  const summary = await getIntegrationOutboxSummary();
  return c.json({ result, summary });
});

fieldRoutes.get(
  "/integrations/crm/customers/:customerId/context",
  async (c) => {
    const forbidden = enforceRole(c, ["dispatcher", "manager", "admin"]);

    if (forbidden) {
      return forbidden;
    }

    if (!featureFlags.crmIntegration) {
      return notEnabled(c, "crmIntegration");
    }

    let context = null;
    try {
      context = await getCustomerContext(c.req.param("customerId"));
    } catch (error) {
      return integrationUnavailable(c, "crm", error);
    }

    if (!context) {
      return c.json({ error: "Customer context not found" }, 404);
    }

    return c.json({ context });
  },
);

fieldRoutes.get("/integrations/invoicing/invoices", async (c) => {
  const forbidden = enforceRole(c, ["dispatcher", "manager", "admin"]);

  if (forbidden) {
    return forbidden;
  }

  if (!featureFlags.invoicingIntegration) {
    return notEnabled(c, "invoicingIntegration");
  }

  try {
    const invoices = await listInvoices();
    return c.json({ invoices });
  } catch (error) {
    return integrationUnavailable(c, "invoicing", error);
  }
});

fieldRoutes.get("/integrations/invoicing/invoices/:invoiceId", async (c) => {
  const forbidden = enforceRole(c, ["dispatcher", "manager", "admin"]);

  if (forbidden) {
    return forbidden;
  }

  if (!featureFlags.invoicingIntegration) {
    return notEnabled(c, "invoicingIntegration");
  }

  let invoice = null;
  try {
    invoice = await getInvoice(c.req.param("invoiceId"));
  } catch (error) {
    return integrationUnavailable(c, "invoicing", error);
  }

  if (!invoice) {
    return c.json({ error: "Invoice not found" }, 404);
  }

  return c.json({ invoice });
});

fieldRoutes.post("/integrations/invoicing/jobs/:jobId/invoice", async (c) => {
  const forbidden = enforceRole(c, ["dispatcher", "manager", "admin"]);

  if (forbidden) {
    return forbidden;
  }

  if (!featureFlags.invoicingIntegration) {
    return notEnabled(c, "invoicingIntegration");
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = invoiceCreateSchema.safeParse(body);

  if (!parsed.success) {
    return validationError(c, parsed.error.issues);
  }

  const job = getJobById(c.req.param("jobId"));

  if (!job) {
    return c.json({ error: "Job not found" }, 404);
  }

  const payload = {
    job,
    taxRatePercent: parsed.data.taxRatePercent,
    calloutFeeCents: parsed.data.calloutFeeCents,
  };
  const idempotencyScope = featureFlags.idempotency
    ? idempotencyKey(c, "create-invoice", payload)
    : null;

  if (idempotencyScope) {
    const replay = await replayIdempotent(c, idempotencyScope);

    if (replay) {
      return replay;
    }
  }

  let result: Awaited<ReturnType<typeof createInvoiceFromCompletedJob>>;
  try {
    result = await createInvoiceFromCompletedJob(payload);
  } catch (error) {
    return integrationUnavailable(c, "invoicing", error);
  }

  if (!result.ok) {
    if (idempotencyScope) {
      await storeIdempotent(idempotencyScope, 409, result);
    }

    return c.json(result, 409);
  }

  if (idempotencyScope) {
    await storeIdempotent(idempotencyScope, 201, result);
  }

  return c.json(result, 201);
});
