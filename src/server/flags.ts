function envFlag(name: string, fallback: boolean) {
  const value = process.env[name];

  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

const isTestRuntime =
  process.env.NODE_ENV === "test" || process.env.VITEST === "true";

export const featureFlags = {
  realtimeBoard: envFlag("FEATURE_REALTIME_BOARD", true),
  crmIntegration: envFlag("FEATURE_CRM_INTEGRATION", true),
  invoicingIntegration: envFlag("FEATURE_INVOICING_INTEGRATION", true),
  predictiveMaintenance: envFlag("FEATURE_PREDICTIVE_MAINTENANCE", true),
  idempotency: envFlag("FEATURE_IDEMPOTENCY", true),
  autoDisruptionMonitor: envFlag("FEATURE_AUTO_DISRUPTION_MONITOR", true),
  mobileSync: envFlag("FEATURE_MOBILE_SYNC", true),
  observabilityMetrics: envFlag("FEATURE_OBSERVABILITY_METRICS", true),
  backgroundWorkers: envFlag("FEATURE_BACKGROUND_WORKERS", !isTestRuntime),
  integrationOutbox: envFlag("FEATURE_INTEGRATION_OUTBOX", true),
} as const;
