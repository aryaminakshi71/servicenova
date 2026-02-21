# ServiceNova AI

Field service AI platform for dispatch, assignment, and operational optimization.

## AI Implementation Scope (From Strategy)
- Strategy mapping: `App 3: FIELDFORCE-AI (Field Service Management)` from `AI_INTEGRATION_STRATEGY.md`.
- Primary mission: optimize technician dispatch and field execution with predictive intelligence.
- AI capabilities to implement:
  - AI dispatch engine (assignment optimization and disruption handling).
  - Route optimization and delay prediction.
  - Work-order intelligence (diagnosis, parts recommendation, duration prediction).
  - Technician assist features (step guidance, voice notes, smart forms).
  - Predictive maintenance and risk forecasting for assets.
- Ecosystem integrations:
  - CRM for customer context and history.
  - Invoicing for automated billing from completed work orders.
- Strategy targets:
  - MVP timeline: 3-4 months.
  - Revenue model: per-technician subscription tiers.

## Current Status
- Scaffold complete (API + frontend + schema + CI).
- Core routes are implemented:
  - `GET /api/health`
  - `GET /api/field/dispatch-board`
  - `POST /api/field/jobs/assign`
  - `POST /api/field/dispatch/disruptions`
- Core schema is implemented in `drizzle/schema.ts`:
  - `technicians`
  - `service_jobs`
  - `route_plans`
- Persistence wiring:
  - In-memory by default.
  - Optional Drizzle/Postgres adapter when `FIELD_OPS_PERSISTENCE=postgres`.
  - For Postgres mode, install `postgres` dependency (`bun add postgres`).
  - Postgres schema now includes `tenant_id` on field-ops, idempotency, and rate-limit tables for storage-level tenant isolation.
  - Postgres mode also persists idempotency keys for replay-safe mutation retries.
  - Postgres mode also persists rate-limit counters for multi-instance throttling consistency.
  - Postgres mode now persists work-order intelligence runs and technician assist briefing history.
  - Postgres mode now persists integration outbox entries and background jobs for restart-safe async processing.
- Security and reliability baseline:
  - Auth + RBAC enforced on all `/api/field/*` endpoints.
  - JWT auth supported via `AUTH_JWT_SECRET` (HS256), with demo-token fallback controls.
  - Tenant context (`tenantId`) is carried in auth and used for tenant-aware rate-limit/idempotency scopes.
  - Field-ops runtime state is tenant-partitioned, so dispatch/jobs/assist/intelligence data is isolated per tenant context.
  - Query-string auth fallback is configurable via `AUTH_ALLOW_QUERY_FALLBACK` (defaults off in production).
  - Per-user/per-route rate limiting protects mutation and integration endpoints.
  - Job lifecycle state machine enforces valid transitions (`open -> assigned -> in_progress -> closed`).
  - Lifecycle failures include stable machine-readable `code` values for client/workflow branching.
  - Idempotency support for mutating APIs via `Idempotency-Key`.
  - Optimistic version checks supported for assignment/complete/unassign payloads.
  - Integration upstream failures return controlled `502` payloads instead of raw server errors.
  - CRM mutation syncs are now queued into a tenant-scoped integration outbox for retry-safe delivery.
  - Dead-letter integration events can be re-queued by operators after upstream recovery.
- Operational foundations:
  - Request tracing with `x-request-id`.
  - Feature flags for realtime, integrations, predictive maintenance, idempotency.
  - Realtime dispatch stream endpoint for SSE consumers.
  - Observability metrics endpoint with p95 latency/error-rate SLO checks.
  - Background worker runtime for queued optimization/disruption/outbox jobs.
- Work-order intelligence:
  - Heuristic intelligence endpoint for diagnosis ranking, parts suggestions, and duration prediction.
  - Prediction history tracks actual-vs-predicted duration errors for accuracy trending.
- Technician assist:
  - Assist briefing endpoint returns guided steps, smart form fields, and voice-note prompts.
  - Provider abstraction supports `mock` (fallback) and `http` model-backed generation.
- Dispatch resilience:
  - Proactive disruption feed sweep endpoint for automated disruption handling.
  - SLA-aware dispatch optimizer endpoint for rebalancing assignments.
- Mobile reliability:
  - Batch sync endpoint for replaying offline technician operations.
  - Client offline queue helper at `src/mobile/offline-queue.ts`.
- Integration architecture:
  - CRM and invoicing provider adapters with `mock` and `http` provider options.
  - HTTP adapters include timeout, retry/backoff, and circuit breaker behavior.
  - Outbox delivery adds exponential backoff + dead-letter handling for CRM work-order sync events.

## Local Runbook
- In this folder:
  - `bun install`
  - `bun run dev`
  - `bun run typecheck`
  - `bun run test:unit`
  - `bun run test:api`
  - `bun run test`
  - `bun run build`
  - `bun run load:smoke`
  - `bun run db:migrate`
  - `bun run db:check`
- From `appnew` root (all apps):
  - `./scripts/run-all.sh install typecheck test build`

## Key Files
- API entry: `src/server/app.ts`
- Field routes: `src/server/routes/field.ts`
- Domain module: `src/features/field-ops/index.ts`
- Data schema: `drizzle/schema.ts`

## Remaining Tasks
- Phase 1: Dispatch Core
  - [x] Add technician shift availability model.
  - [x] Add assignment scoring logic (distance, skill, load).
  - [x] Add unassigned queue and reassignment flows.
- Phase 2: Route Intelligence
  - [x] Integrate map provider abstraction for ETA and route generation.
  - [x] Add route optimization for daily plans.
  - [x] Add traffic-aware replanning triggers.
- Phase 3: Job Execution
  - [x] Add mobile-friendly job checklist endpoints.
  - [x] Add proof-of-service upload and completion notes.
  - [x] Add SLA breach alerts and escalation rules.
- Phase 4: Ops Analytics
  - [x] Add dashboard starter for utilization and queue/SLA visibility.
  - [x] Add predictive maintenance scoring hooks.
  - [x] Add audit trail for manual overrides.

## Newly Added Endpoints
- `POST /api/field/dispatch/disruptions`
- `POST /api/field/jobs/reassign`
- `POST /api/field/jobs/unassign`
- `POST /api/field/dispatch/disruptions/auto-run`
- `POST /api/field/dispatch/optimize`
- `POST /api/field/ops/automation/run-cycle`
- `GET /api/field/ops/jobs`
- `GET /api/field/ops/jobs/:jobId`
- `GET /api/field/integrations/outbox`
- `POST /api/field/integrations/outbox/flush`
- `POST /api/field/integrations/outbox/requeue`
- `GET /api/field/jobs/unassigned`
- `POST /api/field/technicians/:technicianId/shifts`
- `POST /api/field/routes/plan`
- `POST /api/field/routes/replan`
- `GET /api/field/routes/daily`
- `GET /api/field/jobs/:jobId/checklist`
- `POST /api/field/jobs/:jobId/checklist`
- `POST /api/field/jobs/:jobId/proof-of-service`
- `POST /api/field/jobs/:jobId/intelligence`
- `POST /api/field/jobs/:jobId/intelligence/confirm`
- `POST /api/field/jobs/:jobId/assist/briefing`
- `GET /api/field/intelligence/history`
- `GET /api/field/intelligence/accuracy`
- `GET /api/field/intelligence/quality-report`
- `GET /api/field/intelligence/drift-alerts`
- `POST /api/field/mobile/sync`
- `POST /api/field/jobs/:jobId/start`
- `POST /api/field/jobs/:jobId/complete`
- `GET /api/field/alerts/sla-breaches`
- `GET /api/field/analytics/kpis`
- `GET /api/field/observability/metrics`
- `POST /api/field/maintenance/risk-score`
- `POST /api/field/jobs/:jobId/manual-override`
- `GET /api/field/audit-trail`
- `GET /api/field/dispatch-board/stream`
- `GET /api/field/integrations/crm/customers/:customerId/context`
- `GET /api/field/integrations/invoicing/invoices`
- `GET /api/field/integrations/invoicing/invoices/:invoiceId`
- `POST /api/field/integrations/invoicing/jobs/:jobId/invoice`

Async mode is supported on:
- `POST /api/field/dispatch/disruptions/auto-run` with `{ "async": true }`
- `POST /api/field/dispatch/optimize` with `{ "async": true }`
- `POST /api/field/ops/automation/run-cycle` with `{ "async": true }`
- `POST /api/field/integrations/outbox/flush` with `{ "async": true }`

Queued job status can be tracked with:
- `GET /api/field/ops/jobs`
- `GET /api/field/ops/jobs/:jobId`

## Validation and Tests
- Request validation added with `zod` on field routes.
- Unit tests added for assignment, queueing, SLA escalation, and checklist-gated completion.
- Route integration tests added for API flows and integration endpoints.
- Auth/RBAC integration tests added for unauthorized/forbidden/allowed flows.
- API tests cover idempotency replay and optimistic-lock conflict paths.
- API/unit tests cover work-order intelligence generation and RBAC access for technicians.
- API tests cover intelligence history/accuracy retrieval and provider fallback behavior.
- API/unit tests cover dispatch optimizer, auto-disruption sweeps, automation cycle orchestration, drift alerts, mobile sync, observability, and JWT auth flows.
- API tests cover asynchronous job queueing, outbox list/flush controls, and queued CRM sync headers.
- CI now runs unit and API contract test suites separately.
- Verified locally on February 15, 2026:
  - `bun run typecheck`
  - `bun run test`
  - `bun run build`

## Auth and Headers
- Auth is required by default for all `/api/field/*` routes (`AUTH_REQUIRED=true`).
- Demo auth token format:
  - `Authorization: Bearer <role:userId[:tenantId]>`
  - Example: `Authorization: Bearer manager:web-dashboard:tenant-a`
- JWT auth:
  - Configure `AUTH_JWT_SECRET` and send `Authorization: Bearer <jwt>`
  - Claims: `role`, `sub` (or `userId`), optional `tenantId`, optional `iss` (checked by `AUTH_JWT_ISSUER`)
- Demo token fallback:
  - Controlled by `AUTH_ALLOW_DEMO_TOKEN`
- Optional browser-stream fallback:
  - `AUTH_ALLOW_QUERY_FALLBACK=true` allows `role` + `userId` query params when bearer headers are unavailable (for example EventSource clients).
- Rate limiting:
  - `RATE_LIMIT_ENABLED=true`
  - `RATE_LIMIT_WINDOW_MS=60000`
  - `RATE_LIMIT_MUTATION_LIMIT=120`
  - `RATE_LIMIT_INTEGRATION_LIMIT=60`
  - `RATE_LIMIT_ADMIN_MUTATION_LIMIT=300`
  - `RATE_LIMIT_ADMIN_INTEGRATION_LIMIT=180`
  - Optional bypasses: `RATE_LIMIT_BYPASS_ROLES` and `RATE_LIMIT_BYPASS_SUBJECTS`
  - Exceeded requests return `429` with `retry-after` and `x-ratelimit-*` headers.
- Idempotent mutations:
  - Add `Idempotency-Key: <unique-key>` header.
- Queued integration mutations:
  - Successful queueing sets `x-integration-outbox: <entry-id>`.

## Feature Flags
- `FEATURE_REALTIME_BOARD`
- `FEATURE_CRM_INTEGRATION`
- `FEATURE_INVOICING_INTEGRATION`
- `FEATURE_PREDICTIVE_MAINTENANCE`
- `FEATURE_IDEMPOTENCY`
- `FEATURE_AUTO_DISRUPTION_MONITOR`
- `FEATURE_MOBILE_SYNC`
- `FEATURE_OBSERVABILITY_METRICS`
- `FEATURE_BACKGROUND_WORKERS`
- `FEATURE_INTEGRATION_OUTBOX`

## Integration Reliability Policy
- `INTEGRATION_HTTP_RETRIES`
- `INTEGRATION_HTTP_RETRY_BASE_MS`
- `INTEGRATION_HTTP_TIMEOUT_MS`
- `INTEGRATION_HTTP_CIRCUIT_FAILURE_THRESHOLD`
- `INTEGRATION_HTTP_CIRCUIT_COOLDOWN_MS`
- `INTEGRATION_OUTBOX_MAX_ATTEMPTS`
- `INTEGRATION_OUTBOX_RETRY_BASE_MS`
- `INTEGRATION_OUTBOX_RETRY_CAP_MS`
- `INTEGRATION_OUTBOX_FLUSH_MS`
- `INTEGRATION_OUTBOX_FLUSH_BATCH`

## Field Intelligence Provider
- `FIELD_INTELLIGENCE_PROVIDER` (`mock` or `http`)
- `FIELD_INTELLIGENCE_BASE_URL` (required for `http`)
- `FIELD_INTELLIGENCE_API_KEY` (optional bearer token)
- `FIELD_INTELLIGENCE_HTTP_TIMEOUT_MS`
- `INTELLIGENCE_AUTO_ACTION_MIN_CONFIDENCE` (guardrail threshold for recommendation-only mode)

## Disruption Feed Provider
- `DISRUPTION_FEED_PROVIDER` (`mock` or `http`)
- `DISRUPTION_FEED_BASE_URL` (required for `http`)
- `DISRUPTION_FEED_API_KEY` (optional bearer token)
- `DISRUPTION_FEED_TIMEOUT_MS`
- `MOCK_DISRUPTION_ENABLED`
- `AUTO_DISRUPTION_COOLDOWN_MS`

## SLO Targets
- `SLO_AVAILABILITY_TARGET`
- `SLO_P95_MS_TARGET`

## Intelligence Drift Controls
- `INTELLIGENCE_DRIFT_WINDOW_HOURS`
- `INTELLIGENCE_DRIFT_MIN_SAMPLES`
- `INTELLIGENCE_DRIFT_MAX_MAE_MINUTES`
- `INTELLIGENCE_DRIFT_MIN_WITHIN15_RATE`

## Done Criteria
- Dispatch board shows real-time assignment state.
- Route plans are generated and updateable.
- Core operational KPIs are available in-app.

## Lifecycle Error Codes
- Lifecycle mutation responses include `code` values such as:
  - `JOB_NOT_FOUND`
  - `JOB_ALREADY_CLOSED`
  - `JOB_ALREADY_IN_PROGRESS`
  - `JOB_INVALID_STATUS_TRANSITION`
  - `JOB_VERSION_CONFLICT`
  - `JOB_CHECKLIST_INCOMPLETE`
  - `JOB_MISSING_ASSIGNED_TECHNICIAN`
  - `JOB_NOT_ASSIGNED`

## Audit Event Types
- Lifecycle `start` transitions are emitted as `job_status_transition` audit events.
- Dispatch disruption workflows emit `disruption_handled` audit events.
