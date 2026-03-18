ALTER TABLE "audit_trail" ADD COLUMN IF NOT EXISTS "tenant_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "escalation_events" ADD COLUMN IF NOT EXISTS "tenant_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN IF NOT EXISTS "tenant_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "job_checklist_items" ADD COLUMN IF NOT EXISTS "tenant_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "maintenance_risk_assessments" ADD COLUMN IF NOT EXISTS "tenant_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "manual_overrides" ADD COLUMN IF NOT EXISTS "tenant_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "proof_of_service_artifacts" ADD COLUMN IF NOT EXISTS "tenant_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "rate_limit_counters" ADD COLUMN IF NOT EXISTS "tenant_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "route_plans" ADD COLUMN IF NOT EXISTS "tenant_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "service_jobs" ADD COLUMN IF NOT EXISTS "tenant_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "sla_breaches" ADD COLUMN IF NOT EXISTS "tenant_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "technician_assist_briefings" ADD COLUMN IF NOT EXISTS "tenant_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "technician_shifts" ADD COLUMN IF NOT EXISTS "tenant_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "technicians" ADD COLUMN IF NOT EXISTS "tenant_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "unassigned_queue" ADD COLUMN IF NOT EXISTS "tenant_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "work_order_intelligence_runs" ADD COLUMN IF NOT EXISTS "tenant_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rate_limit_counters_tenant_id_idx" ON "rate_limit_counters" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "technician_assist_briefings_tenant_id_idx" ON "technician_assist_briefings" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_order_intelligence_runs_tenant_id_idx" ON "work_order_intelligence_runs" USING btree ("tenant_id");