import type { DispatchDisruptionType, ServiceJob, Technician } from "./service";

export type DisruptionSignal = {
  signalId: string;
  type: DispatchDisruptionType;
  reason: string;
  technicianId?: string;
  affectedJobIds?: string[];
  detectedAt: string;
  severity: "low" | "medium" | "high";
};

export interface DisruptionFeedProvider {
  pollSignals(input: {
    jobs: ServiceJob[];
    technicians: Technician[];
  }): Promise<DisruptionSignal[]>;
}

function parseBooleanEnv(name: string, fallback: boolean) {
  const configured = process.env[name];

  if (configured === undefined) {
    return fallback;
  }

  const normalized = configured.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function mockDisruptionFeedProvider(): DisruptionFeedProvider {
  return {
    async pollSignals(input) {
      const enabled = parseBooleanEnv("MOCK_DISRUPTION_ENABLED", false);

      if (!enabled) {
        return [];
      }

      const impactedJobs = input.jobs.filter(
        (job) => job.technicianId && job.status !== "closed",
      );

      if (impactedJobs.length === 0) {
        return [];
      }

      const technicianId = impactedJobs[0]?.technicianId ?? undefined;

      if (!technicianId) {
        return [];
      }

      return [
        {
          signalId: `sig-${technicianId}-${Date.now()}`,
          type: "technician_unavailable",
          reason: "Mock disruption feed: technician connectivity lost",
          technicianId,
          affectedJobIds: impactedJobs.map((job) => job.id),
          severity: "high",
          detectedAt: new Date().toISOString(),
        },
      ];
    },
  };
}

async function safeJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function httpDisruptionFeedProvider(
  baseUrl: string,
  apiKey?: string,
): DisruptionFeedProvider {
  const timeoutMs = Number.parseInt(
    process.env.DISRUPTION_FEED_TIMEOUT_MS ?? "2500",
    10,
  );
  const headers: Record<string, string> = apiKey
    ? { authorization: `Bearer ${apiKey}` }
    : {};

  return {
    async pollSignals(input) {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        Number.isNaN(timeoutMs) ? 2500 : timeoutMs,
      );

      try {
        const response = await fetch(`${baseUrl}/signals`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...headers,
          },
          body: JSON.stringify({
            jobs: input.jobs.map((job) => ({
              id: job.id,
              status: job.status,
              technicianId: job.technicianId,
              priority: job.priority,
            })),
            technicians: input.technicians.map((technician) => ({
              id: technician.id,
              status: technician.status,
              activeJobCount: technician.activeJobCount,
            })),
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Disruption feed error: HTTP ${response.status}`);
        }

        const payload = await safeJson<{ signals?: DisruptionSignal[] }>(
          response,
        );
        return payload?.signals ?? [];
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

function buildProvider(): DisruptionFeedProvider {
  const provider =
    process.env.DISRUPTION_FEED_PROVIDER?.toLowerCase() ?? "mock";

  if (provider === "http" && process.env.DISRUPTION_FEED_BASE_URL) {
    return httpDisruptionFeedProvider(
      process.env.DISRUPTION_FEED_BASE_URL,
      process.env.DISRUPTION_FEED_API_KEY,
    );
  }

  return mockDisruptionFeedProvider();
}

let runtimeProvider = buildProvider();

export function getDisruptionFeedProvider() {
  return runtimeProvider;
}

export function resetDisruptionFeedProviderForTests() {
  runtimeProvider = buildProvider();
}
