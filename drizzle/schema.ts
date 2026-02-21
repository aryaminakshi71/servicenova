import {
  boolean,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const technicianStatusEnum = pgEnum("technician_status", [
  "available",
  "busy",
  "offline",
]);
export const serviceJobStatusEnum = pgEnum("service_job_status", [
  "open",
  "assigned",
  "in_progress",
  "closed",
]);
export const jobPriorityEnum = pgEnum("job_priority", [
  "low",
  "normal",
  "high",
  "urgent",
]);
export const routePlanTriggerEnum = pgEnum("route_plan_trigger", [
  "manual",
  "traffic",
  "assignment",
]);
export const auditEventTypeEnum = pgEnum("audit_event_type", [
  "job_assigned",
  "job_reassigned",
  "job_unassigned",
  "disruption_handled",
  "job_status_transition",
  "job_completed",
  "manual_override",
  "shift_updated",
  "route_replanned",
]);
export const integrationOutboxStatusEnum = pgEnum("integration_outbox_status", [
  "pending",
  "processing",
  "delivered",
  "dead_letter",
]);
export const integrationOutboxTypeEnum = pgEnum("integration_outbox_type", [
  "crm_work_order_event",
]);
export const backgroundJobTypeEnum = pgEnum("background_job_type", [
  "dispatch_auto_disruption",
  "dispatch_optimize",
  "integration_outbox_flush",
]);
export const backgroundJobStatusEnum = pgEnum("background_job_status", [
  "queued",
  "running",
  "completed",
  "failed",
]);

export const technicians = pgTable(
  "technicians",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: text("tenant_id").notNull().default("default"),
    name: text("name").notNull(),
    status: technicianStatusEnum("status").notNull().default("available"),
    homeBase: text("home_base").notNull(),
    locationLat: doublePrecision("location_lat").notNull().default(0),
    locationLng: doublePrecision("location_lng").notNull().default(0),
    skillsCsv: text("skills_csv").notNull().default(""),
    shiftStart: text("shift_start").notNull().default("08:00"),
    shiftEnd: text("shift_end").notNull().default("17:00"),
    activeJobCount: integer("active_job_count").notNull().default(0),
    maxConcurrentJobs: integer("max_concurrent_jobs").notNull().default(2),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    tenantIdIdx: index("technicians_tenant_id_idx").on(table.tenantId),
    tenantScopedIdUnique: uniqueIndex("technicians_tenant_id_id_uniq").on(
      table.tenantId,
      table.id,
    ),
  }),
);

export const technicianShifts = pgTable(
  "technician_shifts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: text("tenant_id").notNull().default("default"),
    technicianId: uuid("technician_id")
      .notNull()
      .references(() => technicians.id),
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    effectiveDate: text("effective_date").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    tenantTechnicianFk: foreignKey({
      name: "technician_shifts_tenant_technician_fk",
      columns: [table.tenantId, table.technicianId],
      foreignColumns: [technicians.tenantId, technicians.id],
    }),
    tenantTechnicianIdx: index("technician_shifts_tenant_technician_idx").on(
      table.tenantId,
      table.technicianId,
    ),
  }),
);

export const serviceJobs = pgTable(
  "service_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: text("tenant_id").notNull().default("default"),
    title: text("title").notNull(),
    customerId: text("customer_id"),
    location: text("location").notNull(),
    locationLat: doublePrecision("location_lat").notNull().default(0),
    locationLng: doublePrecision("location_lng").notNull().default(0),
    version: integer("version").notNull().default(1),
    status: serviceJobStatusEnum("status").notNull().default("open"),
    technicianId: uuid("technician_id").references(() => technicians.id),
    requiredSkillsCsv: text("required_skills_csv").notNull().default(""),
    priority: jobPriorityEnum("priority").notNull().default("normal"),
    slaDueAt: timestamp("sla_due_at", { withTimezone: true }),
    estimatedMinutes: integer("estimated_minutes").notNull().default(60),
    completionNotes: text("completion_notes"),
    firstTimeFix: boolean("first_time_fix"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    tenantIdIdx: index("service_jobs_tenant_id_idx").on(table.tenantId),
    tenantScopedIdUnique: uniqueIndex("service_jobs_tenant_id_id_uniq").on(
      table.tenantId,
      table.id,
    ),
  }),
);

export const routePlans = pgTable(
  "route_plans",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: text("tenant_id").notNull().default("default"),
    technicianId: uuid("technician_id")
      .notNull()
      .references(() => technicians.id),
    date: text("date").notNull(),
    routeSummary: text("route_summary").notNull(),
    totalTravelMinutes: integer("total_travel_minutes").notNull().default(0),
    totalDistanceKm: doublePrecision("total_distance_km").notNull().default(0),
    delayRisk: text("delay_risk").notNull().default("low"),
    triggeredBy: routePlanTriggerEnum("triggered_by")
      .notNull()
      .default("manual"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    tenantTechnicianFk: foreignKey({
      name: "route_plans_tenant_technician_fk",
      columns: [table.tenantId, table.technicianId],
      foreignColumns: [technicians.tenantId, technicians.id],
    }),
    tenantTechnicianIdx: index("route_plans_tenant_technician_idx").on(
      table.tenantId,
      table.technicianId,
    ),
  }),
);

export const unassignedQueue = pgTable(
  "unassigned_queue",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: text("tenant_id").notNull().default("default"),
    jobId: uuid("job_id")
      .notNull()
      .references(() => serviceJobs.id),
    reason: text("reason").notNull(),
    queuedAt: timestamp("queued_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => ({
    tenantJobFk: foreignKey({
      name: "unassigned_queue_tenant_job_fk",
      columns: [table.tenantId, table.jobId],
      foreignColumns: [serviceJobs.tenantId, serviceJobs.id],
    }),
    tenantJobIdx: index("unassigned_queue_tenant_job_idx").on(
      table.tenantId,
      table.jobId,
    ),
  }),
);

export const jobChecklistItems = pgTable(
  "job_checklist_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: text("tenant_id").notNull().default("default"),
    jobId: uuid("job_id")
      .notNull()
      .references(() => serviceJobs.id),
    label: text("label").notNull(),
    required: boolean("required").notNull().default(true),
    done: boolean("done").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    tenantJobFk: foreignKey({
      name: "job_checklist_items_tenant_job_fk",
      columns: [table.tenantId, table.jobId],
      foreignColumns: [serviceJobs.tenantId, serviceJobs.id],
    }),
    tenantJobIdx: index("job_checklist_items_tenant_job_idx").on(
      table.tenantId,
      table.jobId,
    ),
  }),
);

export const proofOfServiceArtifacts = pgTable(
  "proof_of_service_artifacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: text("tenant_id").notNull().default("default"),
    jobId: uuid("job_id")
      .notNull()
      .references(() => serviceJobs.id),
    proofUrl: text("proof_url").notNull(),
    note: text("note"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    tenantJobFk: foreignKey({
      name: "proof_of_service_artifacts_tenant_job_fk",
      columns: [table.tenantId, table.jobId],
      foreignColumns: [serviceJobs.tenantId, serviceJobs.id],
    }),
    tenantJobIdx: index("proof_of_service_artifacts_tenant_job_idx").on(
      table.tenantId,
      table.jobId,
    ),
  }),
);

export const slaBreaches = pgTable(
  "sla_breaches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: text("tenant_id").notNull().default("default"),
    jobId: uuid("job_id")
      .notNull()
      .references(() => serviceJobs.id),
    priority: jobPriorityEnum("priority").notNull(),
    minutesOverdue: integer("minutes_overdue").notNull(),
    escalated: boolean("escalated").notNull().default(false),
    breachedAt: timestamp("breached_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    clearedAt: timestamp("cleared_at", { withTimezone: true }),
  },
  (table) => ({
    tenantJobFk: foreignKey({
      name: "sla_breaches_tenant_job_fk",
      columns: [table.tenantId, table.jobId],
      foreignColumns: [serviceJobs.tenantId, serviceJobs.id],
    }),
    tenantJobIdx: index("sla_breaches_tenant_job_idx").on(
      table.tenantId,
      table.jobId,
    ),
  }),
);

export const escalationEvents = pgTable(
  "escalation_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: text("tenant_id").notNull().default("default"),
    jobId: uuid("job_id")
      .notNull()
      .references(() => serviceJobs.id),
    severity: text("severity").notNull(),
    rule: text("rule").notNull(),
    triggeredAt: timestamp("triggered_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    tenantJobFk: foreignKey({
      name: "escalation_events_tenant_job_fk",
      columns: [table.tenantId, table.jobId],
      foreignColumns: [serviceJobs.tenantId, serviceJobs.id],
    }),
    tenantJobIdx: index("escalation_events_tenant_job_idx").on(
      table.tenantId,
      table.jobId,
    ),
  }),
);

export const auditTrail = pgTable("audit_trail", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: text("tenant_id").notNull().default("default"),
  eventType: auditEventTypeEnum("event_type").notNull(),
  actor: text("actor").notNull(),
  details: jsonb("details").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const maintenanceRiskAssessments = pgTable(
  "maintenance_risk_assessments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: text("tenant_id").notNull().default("default"),
    assetId: text("asset_id").notNull(),
    riskScore: doublePrecision("risk_score").notNull(),
    riskBand: text("risk_band").notNull(),
    factors: jsonb("factors").$type<Record<string, number>>().notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
);

export const manualOverrides = pgTable(
  "manual_overrides",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: text("tenant_id").notNull().default("default"),
    jobId: uuid("job_id")
      .notNull()
      .references(() => serviceJobs.id),
    actor: text("actor").notNull(),
    reason: text("reason").notNull(),
    changes: jsonb("changes").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    tenantJobFk: foreignKey({
      name: "manual_overrides_tenant_job_fk",
      columns: [table.tenantId, table.jobId],
      foreignColumns: [serviceJobs.tenantId, serviceJobs.id],
    }),
    tenantJobIdx: index("manual_overrides_tenant_job_idx").on(
      table.tenantId,
      table.jobId,
    ),
  }),
);

export const workOrderIntelligenceRuns = pgTable(
  "work_order_intelligence_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: text("tenant_id").notNull().default("default"),
    jobId: uuid("job_id")
      .notNull()
      .references(() => serviceJobs.id),
    statusAtPrediction: serviceJobStatusEnum("status_at_prediction").notNull(),
    predictedDurationMinutes: integer("predicted_duration_minutes").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    probableDiagnoses: jsonb("probable_diagnoses")
      .$type<Array<{ label: string; confidence: number; rationale: string }>>()
      .notNull(),
    recommendedParts: jsonb("recommended_parts").$type<string[]>().notNull(),
    recommendedActions: jsonb("recommended_actions")
      .$type<string[]>()
      .notNull(),
    symptoms: jsonb("symptoms").$type<string[]>().notNull(),
    notes: text("notes"),
    generatedAt: timestamp("generated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    actualDurationMinutes: integer("actual_duration_minutes"),
    durationErrorMinutes: integer("duration_error_minutes"),
  },
  (table) => ({
    tenantJobFk: foreignKey({
      name: "work_order_intelligence_runs_tenant_job_fk",
      columns: [table.tenantId, table.jobId],
      foreignColumns: [serviceJobs.tenantId, serviceJobs.id],
    }),
    jobIdIdx: index("work_order_intelligence_runs_job_id_idx").on(table.jobId),
    tenantJobIdx: index("work_order_intelligence_runs_tenant_job_idx").on(
      table.tenantId,
      table.jobId,
    ),
    generatedAtIdx: index("work_order_intelligence_runs_generated_at_idx").on(
      table.generatedAt,
    ),
    tenantIdIdx: index("work_order_intelligence_runs_tenant_id_idx").on(
      table.tenantId,
    ),
  }),
);

export const technicianAssistBriefings = pgTable(
  "technician_assist_briefings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: text("tenant_id").notNull().default("default"),
    jobId: uuid("job_id")
      .notNull()
      .references(() => serviceJobs.id),
    statusAtGeneration: serviceJobStatusEnum("status_at_generation").notNull(),
    recommendedSteps: jsonb("recommended_steps").$type<string[]>().notNull(),
    smartFormFields: jsonb("smart_form_fields").$type<string[]>().notNull(),
    voiceNotePrompts: jsonb("voice_note_prompts").$type<string[]>().notNull(),
    riskFlags: jsonb("risk_flags").$type<string[]>().notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    tenantJobFk: foreignKey({
      name: "technician_assist_briefings_tenant_job_fk",
      columns: [table.tenantId, table.jobId],
      foreignColumns: [serviceJobs.tenantId, serviceJobs.id],
    }),
    jobIdIdx: index("technician_assist_briefings_job_id_idx").on(table.jobId),
    tenantJobIdx: index("technician_assist_briefings_tenant_job_idx").on(
      table.tenantId,
      table.jobId,
    ),
    generatedAtIdx: index("technician_assist_briefings_generated_at_idx").on(
      table.generatedAt,
    ),
    tenantIdIdx: index("technician_assist_briefings_tenant_id_idx").on(
      table.tenantId,
    ),
  }),
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: text("tenant_id").notNull().default("default"),
    scopeKey: text("scope_key").notNull(),
    responseStatus: integer("response_status").notNull(),
    responseBody: jsonb("response_body")
      .$type<Record<string, unknown>>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    tenantScopeUnique: uniqueIndex("idempotency_keys_tenant_scope_uniq").on(
      table.tenantId,
      table.scopeKey,
    ),
    tenantCreatedAtIdx: index("idempotency_keys_tenant_created_at_idx").on(
      table.tenantId,
      table.createdAt,
    ),
  }),
);

export const rateLimitCounters = pgTable(
  "rate_limit_counters",
  {
    scopeKey: text("scope_key").primaryKey(),
    tenantId: text("tenant_id").notNull().default("default"),
    hitCount: integer("hit_count").notNull().default(0),
    resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    resetAtIdx: index("rate_limit_counters_reset_at_idx").on(table.resetAt),
    tenantIdIdx: index("rate_limit_counters_tenant_id_idx").on(table.tenantId),
  }),
);

export const integrationOutbox = pgTable(
  "integration_outbox",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().default("default"),
    type: integrationOutboxTypeEnum("type")
      .notNull()
      .default("crm_work_order_event"),
    status: integrationOutboxStatusEnum("status").notNull().default("pending"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    lastError: text("last_error"),
  },
  (table) => ({
    tenantStatusAttemptIdx: index(
      "integration_outbox_tenant_status_next_attempt_idx",
    ).on(table.tenantId, table.status, table.nextAttemptAt),
    tenantCreatedAtIdx: index("integration_outbox_tenant_created_at_idx").on(
      table.tenantId,
      table.createdAt,
    ),
  }),
);

export const backgroundJobs = pgTable(
  "background_jobs",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().default("default"),
    type: backgroundJobTypeEnum("type").notNull(),
    status: backgroundJobStatusEnum("status").notNull().default("queued"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    result: jsonb("result").$type<unknown>(),
    error: text("error"),
    queuedAt: timestamp("queued_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => ({
    tenantQueuedAtIdx: index("background_jobs_tenant_queued_at_idx").on(
      table.tenantId,
      table.queuedAt,
    ),
    statusQueuedAtIdx: index("background_jobs_status_queued_at_idx").on(
      table.status,
      table.queuedAt,
    ),
  }),
);
