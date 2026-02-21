export const fieldOpsModules = [
  "dispatch",
  "technician-assist",
  "route-optimization",
  "maintenance-insights",
  "ops-analytics",
] as const;

export function getFieldOpsSummary() {
  return {
    domain: "field-service-ai",
    modules: fieldOpsModules,
  };
}

export * from "./service";
