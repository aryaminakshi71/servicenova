import {
	boolean,
	doublePrecision,
	foreignKey,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

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

export const fieldDashboardOnboardingStates = pgTable(
	"field_dashboard_onboarding_states",
	{
		tenantId: text("tenant_id").notNull().default("default"),
		userId: text("user_id").notNull(),
		selectedJob: boolean("selected_job").notNull().default(false),
		intelligenceRun: boolean("intelligence_run").notNull().default(false),
		dispatchOptimized: boolean("dispatch_optimized").notNull().default(false),
		automationCycle: boolean("automation_cycle").notNull().default(false),
		dismissed: boolean("dismissed").notNull().default(false),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedBy: text("updated_by").notNull(),
	},
	(table) => ({
		pk: primaryKey({
			name: "field_dashboard_onboarding_states_pk",
			columns: [table.tenantId, table.userId],
		}),
		tenantUpdatedAtIdx: index(
			"field_dashboard_onboarding_states_tenant_updated_at_idx",
		).on(table.tenantId, table.updatedAt),
	}),
);

export const fieldDriftAlertAcknowledgements = pgTable(
	"field_drift_alert_acknowledgements",
	{
		tenantId: text("tenant_id").notNull().default("default"),
		alertId: text("alert_id").notNull(),
		owner: text("owner").notNull(),
		acknowledgedBy: text("acknowledged_by").notNull(),
		acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		slaDueAt: timestamp("sla_due_at", { withTimezone: true }).notNull(),
		note: text("note"),
	},
	(table) => ({
		pk: primaryKey({
			name: "field_drift_alert_acknowledgements_pk",
			columns: [table.tenantId, table.alertId],
		}),
		tenantAckAtIdx: index(
			"field_drift_alert_acknowledgements_tenant_ack_at_idx",
		).on(table.tenantId, table.acknowledgedAt),
	}),
);

export const fieldIncidentTimeline = pgTable(
	"field_incident_timeline",
	{
		id: text("id").primaryKey(),
		tenantId: text("tenant_id").notNull().default("default"),
		type: text("type").notNull(),
		severity: text("severity").notNull(),
		message: text("message").notNull(),
		occurredAt: timestamp("occurred_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		actor: text("actor").notNull(),
		context: jsonb("context").$type<Record<string, unknown>>().notNull(),
	},
	(table) => ({
		tenantOccurredAtIdx: index(
			"field_incident_timeline_tenant_occurred_at_idx",
		).on(table.tenantId, table.occurredAt),
		tenantSeverityIdx: index("field_incident_timeline_tenant_severity_idx").on(
			table.tenantId,
			table.severity,
		),
	}),
);

// ============================================================================
// Better Auth Tables
// ============================================================================

export const users = pgTable("users", {
	id: uuid("id").defaultRandom().primaryKey(),
	email: text("email").notNull().unique(),
	name: text("name").notNull(),
	image: text("image"),
	emailVerified: boolean("email_verified").notNull().default(false),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

export const sessions = pgTable("sessions", {
	id: uuid("id").primaryKey().defaultRandom(),
	userId: uuid("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	token: text("token").notNull().unique(),
	expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

export const accounts = pgTable("accounts", {
	id: uuid("id").primaryKey().defaultRandom(),
	userId: uuid("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	accountId: text("account_id").notNull(),
	providerId: text("provider_id").notNull(),
	accessToken: text("access_token"),
	refreshToken: text("refresh_token"),
	accessTokenExpiresAt: timestamp("access_token_expires_at", {
		withTimezone: true,
	}),
	refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
		withTimezone: true,
	}),
	scope: text("scope"),
	idToken: text("id_token"),
	password: text("password"),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

export const verificationTokens = pgTable("verification_tokens", {
	id: uuid("id").primaryKey().defaultRandom(),
	identifier: text("identifier").notNull(),
	value: text("value").notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

export const organizations = pgTable("organizations", {
	id: uuid("id").primaryKey().defaultRandom(),
	name: text("name").notNull(),
	slug: text("slug").notNull().unique(),
	logo: text("logo"),
	metadata: jsonb("metadata").$type<Record<string, unknown>>(),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

export const members = pgTable("members", {
	id: uuid("id").primaryKey().defaultRandom(),
	organizationId: uuid("organization_id")
		.notNull()
		.references(() => organizations.id, { onDelete: "cascade" }),
	userId: uuid("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	role: text("role").notNull().default("member"),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

export const memberInvitations = pgTable("member_invitations", {
	id: uuid("id").primaryKey().defaultRandom(),
	organizationId: uuid("organization_id")
		.notNull()
		.references(() => organizations.id, { onDelete: "cascade" }),
	email: text("email").notNull(),
	role: text("role").notNull().default("member"),
	status: text("status").notNull().default("pending"),
	expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	inviterId: uuid("inviter_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});
