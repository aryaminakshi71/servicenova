DO $$ BEGIN
 CREATE TYPE "public"."background_job_status" AS ENUM('queued', 'running', 'completed', 'failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."background_job_type" AS ENUM('dispatch_auto_disruption', 'dispatch_optimize', 'integration_outbox_flush');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."integration_outbox_status" AS ENUM('pending', 'processing', 'delivered', 'dead_letter');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."integration_outbox_type" AS ENUM('crm_work_order_event');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "background_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text DEFAULT 'default' NOT NULL,
	"type" "background_job_type" NOT NULL,
	"status" "background_job_status" DEFAULT 'queued' NOT NULL,
	"payload" jsonb NOT NULL,
	"result" jsonb,
	"error" text,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "integration_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text DEFAULT 'default' NOT NULL,
	"type" "integration_outbox_type" DEFAULT 'crm_work_order_event' NOT NULL,
	"status" "integration_outbox_status" DEFAULT 'pending' NOT NULL,
	"payload" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "background_jobs_tenant_queued_at_idx" ON "background_jobs" USING btree ("tenant_id","queued_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "background_jobs_status_queued_at_idx" ON "background_jobs" USING btree ("status","queued_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integration_outbox_tenant_status_next_attempt_idx" ON "integration_outbox" USING btree ("tenant_id","status","next_attempt_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integration_outbox_tenant_created_at_idx" ON "integration_outbox" USING btree ("tenant_id","created_at");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "escalation_events" ADD CONSTRAINT "escalation_events_tenant_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."service_jobs"("tenant_id","id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_checklist_items" ADD CONSTRAINT "job_checklist_items_tenant_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."service_jobs"("tenant_id","id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "manual_overrides" ADD CONSTRAINT "manual_overrides_tenant_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."service_jobs"("tenant_id","id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proof_of_service_artifacts" ADD CONSTRAINT "proof_of_service_artifacts_tenant_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."service_jobs"("tenant_id","id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "route_plans" ADD CONSTRAINT "route_plans_tenant_technician_fk" FOREIGN KEY ("tenant_id","technician_id") REFERENCES "public"."technicians"("tenant_id","id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sla_breaches" ADD CONSTRAINT "sla_breaches_tenant_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."service_jobs"("tenant_id","id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "technician_assist_briefings" ADD CONSTRAINT "technician_assist_briefings_tenant_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."service_jobs"("tenant_id","id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "technician_shifts" ADD CONSTRAINT "technician_shifts_tenant_technician_fk" FOREIGN KEY ("tenant_id","technician_id") REFERENCES "public"."technicians"("tenant_id","id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "unassigned_queue" ADD CONSTRAINT "unassigned_queue_tenant_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."service_jobs"("tenant_id","id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_order_intelligence_runs" ADD CONSTRAINT "work_order_intelligence_runs_tenant_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."service_jobs"("tenant_id","id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "escalation_events_tenant_job_idx" ON "escalation_events" USING btree ("tenant_id","job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_checklist_items_tenant_job_idx" ON "job_checklist_items" USING btree ("tenant_id","job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "manual_overrides_tenant_job_idx" ON "manual_overrides" USING btree ("tenant_id","job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proof_of_service_artifacts_tenant_job_idx" ON "proof_of_service_artifacts" USING btree ("tenant_id","job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "route_plans_tenant_technician_idx" ON "route_plans" USING btree ("tenant_id","technician_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sla_breaches_tenant_job_idx" ON "sla_breaches" USING btree ("tenant_id","job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "technician_assist_briefings_tenant_job_idx" ON "technician_assist_briefings" USING btree ("tenant_id","job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "technician_shifts_tenant_technician_idx" ON "technician_shifts" USING btree ("tenant_id","technician_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "unassigned_queue_tenant_job_idx" ON "unassigned_queue" USING btree ("tenant_id","job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_order_intelligence_runs_tenant_job_idx" ON "work_order_intelligence_runs" USING btree ("tenant_id","job_id");
