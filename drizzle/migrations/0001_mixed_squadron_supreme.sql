CREATE TABLE IF NOT EXISTS "rate_limit_counters" (
	"scope_key" text PRIMARY KEY NOT NULL,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"reset_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
