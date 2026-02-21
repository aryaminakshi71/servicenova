CREATE UNIQUE INDEX IF NOT EXISTS "idempotency_keys_tenant_scope_uniq" ON "idempotency_keys" USING btree ("tenant_id","scope_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idempotency_keys_tenant_created_at_idx" ON "idempotency_keys" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_jobs_tenant_id_idx" ON "service_jobs" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "service_jobs_tenant_id_id_uniq" ON "service_jobs" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "technicians_tenant_id_idx" ON "technicians" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "technicians_tenant_id_id_uniq" ON "technicians" USING btree ("tenant_id","id");