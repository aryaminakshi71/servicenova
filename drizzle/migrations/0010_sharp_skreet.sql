CREATE TABLE IF NOT EXISTS "field_dashboard_onboarding_states" (
	"tenant_id" text DEFAULT 'default' NOT NULL,
	"user_id" text NOT NULL,
	"selected_job" boolean DEFAULT false NOT NULL,
	"intelligence_run" boolean DEFAULT false NOT NULL,
	"dispatch_optimized" boolean DEFAULT false NOT NULL,
	"automation_cycle" boolean DEFAULT false NOT NULL,
	"dismissed" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "field_dashboard_onboarding_states_pk" PRIMARY KEY("tenant_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "field_drift_alert_acknowledgements" (
	"tenant_id" text DEFAULT 'default' NOT NULL,
	"alert_id" text NOT NULL,
	"owner" text NOT NULL,
	"acknowledged_by" text NOT NULL,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sla_due_at" timestamp with time zone NOT NULL,
	"note" text,
	CONSTRAINT "field_drift_alert_acknowledgements_pk" PRIMARY KEY("tenant_id","alert_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "field_incident_timeline" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text DEFAULT 'default' NOT NULL,
	"type" text NOT NULL,
	"severity" text NOT NULL,
	"message" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"context" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "field_dashboard_onboarding_states_tenant_updated_at_idx" ON "field_dashboard_onboarding_states" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "field_drift_alert_acknowledgements_tenant_ack_at_idx" ON "field_drift_alert_acknowledgements" USING btree ("tenant_id","acknowledged_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "field_incident_timeline_tenant_occurred_at_idx" ON "field_incident_timeline" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "field_incident_timeline_tenant_severity_idx" ON "field_incident_timeline" USING btree ("tenant_id","severity");