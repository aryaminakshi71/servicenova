CREATE TABLE IF NOT EXISTS "technician_assist_briefings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"status_at_generation" "service_job_status" NOT NULL,
	"recommended_steps" jsonb NOT NULL,
	"smart_form_fields" jsonb NOT NULL,
	"voice_note_prompts" jsonb NOT NULL,
	"risk_flags" jsonb NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_order_intelligence_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"status_at_prediction" "service_job_status" NOT NULL,
	"predicted_duration_minutes" integer NOT NULL,
	"confidence" double precision NOT NULL,
	"probable_diagnoses" jsonb NOT NULL,
	"recommended_parts" jsonb NOT NULL,
	"recommended_actions" jsonb NOT NULL,
	"symptoms" jsonb NOT NULL,
	"notes" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actual_duration_minutes" integer,
	"duration_error_minutes" integer
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "technician_assist_briefings" ADD CONSTRAINT "technician_assist_briefings_job_id_service_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."service_jobs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_order_intelligence_runs" ADD CONSTRAINT "work_order_intelligence_runs_job_id_service_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."service_jobs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "technician_assist_briefings_job_id_idx" ON "technician_assist_briefings" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "technician_assist_briefings_generated_at_idx" ON "technician_assist_briefings" USING btree ("generated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_order_intelligence_runs_job_id_idx" ON "work_order_intelligence_runs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_order_intelligence_runs_generated_at_idx" ON "work_order_intelligence_runs" USING btree ("generated_at");