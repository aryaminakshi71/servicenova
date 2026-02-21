import type {
  TechnicianAssistBriefing,
  WorkOrderIntelligence,
} from "./service";

type ProviderWorkOrderIntelligence = Omit<
  WorkOrderIntelligence,
  "jobId" | "status"
>;
type ProviderTechnicianAssistBriefing = Omit<
  TechnicianAssistBriefing,
  "jobId" | "status"
>;

export interface FieldIntelligenceProvider {
  generateWorkOrderIntelligence(input: {
    jobId: string;
    title: string;
    requiredSkills: string[];
    estimatedMinutes: number;
    priority: "low" | "normal" | "high" | "urgent";
    symptoms?: string[];
    notes?: string;
  }): Promise<ProviderWorkOrderIntelligence | null>;
  generateTechnicianAssistBriefing(input: {
    jobId: string;
    status: "open" | "assigned" | "in_progress" | "closed";
    requiredSkills: string[];
    checklist: Array<{
      id: string;
      label: string;
      required: boolean;
      done: boolean;
    }>;
    noteContext?: string;
  }): Promise<ProviderTechnicianAssistBriefing | null>;
}

function mockProvider(): FieldIntelligenceProvider {
  return {
    async generateWorkOrderIntelligence() {
      return null;
    },
    async generateTechnicianAssistBriefing() {
      return null;
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

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function httpProvider(
  baseUrl: string,
  apiKey?: string,
): FieldIntelligenceProvider {
  const timeoutMs = Number.parseInt(
    process.env.FIELD_INTELLIGENCE_HTTP_TIMEOUT_MS ?? "2500",
    10,
  );
  const headers: Record<string, string> = apiKey
    ? { authorization: `Bearer ${apiKey}` }
    : {};

  return {
    async generateWorkOrderIntelligence(input) {
      const response = await fetchWithTimeout(
        `${baseUrl}/work-order-intelligence`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...headers,
          },
          body: JSON.stringify(input),
        },
        Number.isNaN(timeoutMs) ? 2500 : timeoutMs,
      );

      if (!response.ok) {
        throw new Error(
          `Field intelligence provider error: HTTP ${response.status}`,
        );
      }

      const payload = await safeJson<{
        result?: ProviderWorkOrderIntelligence;
      }>(response);
      return payload?.result ?? null;
    },
    async generateTechnicianAssistBriefing(input) {
      const response = await fetchWithTimeout(
        `${baseUrl}/technician-assist-briefing`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...headers,
          },
          body: JSON.stringify(input),
        },
        Number.isNaN(timeoutMs) ? 2500 : timeoutMs,
      );

      if (!response.ok) {
        throw new Error(
          `Field intelligence provider error: HTTP ${response.status}`,
        );
      }

      const payload = await safeJson<{
        result?: ProviderTechnicianAssistBriefing;
      }>(response);
      return payload?.result ?? null;
    },
  };
}

function buildProvider() {
  const provider =
    process.env.FIELD_INTELLIGENCE_PROVIDER?.toLowerCase() ?? "mock";

  if (provider === "http" && process.env.FIELD_INTELLIGENCE_BASE_URL) {
    return httpProvider(
      process.env.FIELD_INTELLIGENCE_BASE_URL,
      process.env.FIELD_INTELLIGENCE_API_KEY,
    );
  }

  return mockProvider();
}

let runtimeProvider = buildProvider();

export function getFieldIntelligenceProvider() {
  return runtimeProvider;
}

export function resetFieldIntelligenceProviderForTests() {
  runtimeProvider = buildProvider();
}
