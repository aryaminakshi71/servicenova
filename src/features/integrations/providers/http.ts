import type {
  CrmAdapter,
  CrmCustomerRecord,
  CrmWorkOrderEvent,
  InvoiceRecord,
  InvoiceRequest,
  InvoicingAdapter,
} from "../adapters";

type ReliabilityPolicy = {
  retries: number;
  retryBaseMs: number;
  timeoutMs: number;
  failureThreshold: number;
  cooldownMs: number;
};

type CircuitState = {
  consecutiveFailures: number;
  openedAt: number | null;
};

const circuits = new Map<string, CircuitState>();

async function safeJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function parseIntEnv(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name];

  if (raw === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);

  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function policy(): ReliabilityPolicy {
  return {
    retries: parseIntEnv("INTEGRATION_HTTP_RETRIES", 2, 0, 10),
    retryBaseMs: parseIntEnv("INTEGRATION_HTTP_RETRY_BASE_MS", 20, 0, 5_000),
    timeoutMs: parseIntEnv("INTEGRATION_HTTP_TIMEOUT_MS", 2_500, 100, 30_000),
    failureThreshold: parseIntEnv(
      "INTEGRATION_HTTP_CIRCUIT_FAILURE_THRESHOLD",
      3,
      1,
      100,
    ),
    cooldownMs: parseIntEnv(
      "INTEGRATION_HTTP_CIRCUIT_COOLDOWN_MS",
      30_000,
      500,
      600_000,
    ),
  };
}

function circuitFor(service: "crm" | "invoicing", operation: string) {
  const key = `${service}:${operation}`;
  const current = circuits.get(key);

  if (current) {
    return current;
  }

  const initial: CircuitState = { consecutiveFailures: 0, openedAt: null };
  circuits.set(key, initial);
  return initial;
}

function isCircuitOpen(state: CircuitState, now: number, cooldownMs: number) {
  if (state.openedAt === null) {
    return false;
  }

  if (now - state.openedAt >= cooldownMs) {
    state.openedAt = null;
    state.consecutiveFailures = 0;
    return false;
  }

  return true;
}

function onFailure(state: CircuitState, failureThreshold: number) {
  state.consecutiveFailures += 1;

  if (state.consecutiveFailures >= failureThreshold) {
    state.openedAt = Date.now();
  }
}

function onSuccess(state: CircuitState) {
  state.consecutiveFailures = 0;
  state.openedAt = null;
}

function shouldRetryStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

async function sleep(ms: number) {
  if (ms <= 0) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWithPolicy(
  service: "crm" | "invoicing",
  operation: string,
  url: string,
  init: RequestInit,
) {
  const config = policy();
  const state = circuitFor(service, operation);
  const maxAttempts = config.retries + 1;
  const now = Date.now();

  if (isCircuitOpen(state, now, config.cooldownMs)) {
    throw new Error(
      `${service.toUpperCase()} circuit is open for ${operation}`,
    );
  }

  let attempt = 0;
  let lastError: unknown = null;

  while (attempt < maxAttempts) {
    attempt += 1;

    try {
      const response = await fetchWithTimeout(url, init, config.timeoutMs);

      if (!shouldRetryStatus(response.status)) {
        onSuccess(state);
        return response;
      }

      lastError = new Error(`${service.toUpperCase()} HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    onFailure(state, config.failureThreshold);

    if (state.openedAt !== null || attempt >= maxAttempts) {
      break;
    }

    await sleep(config.retryBaseMs * attempt);
  }

  throw new Error(
    `${service.toUpperCase()} request failed for ${operation}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

export function resetHttpIntegrationReliabilityForTests() {
  circuits.clear();
}

export function createHttpCrmAdapter(
  baseUrl: string,
  apiKey?: string,
): CrmAdapter {
  const headers: Record<string, string> = apiKey
    ? { authorization: `Bearer ${apiKey}` }
    : {};

  return {
    async getCustomerContext(customerId: string) {
      const response = await fetchWithPolicy(
        "crm",
        "get-customer-context",
        `${baseUrl}/customers/${customerId}`,
        {
          headers,
        },
      );

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        throw new Error(`CRM provider error: HTTP ${response.status}`);
      }

      return safeJson<CrmCustomerRecord>(response);
    },
    async recordWorkOrderEvent(event: CrmWorkOrderEvent) {
      const response = await fetchWithPolicy(
        "crm",
        "record-work-order-event",
        `${baseUrl}/work-orders/events`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...headers,
          },
          body: JSON.stringify(event),
        },
      );

      if (!response.ok) {
        throw new Error(`CRM provider error: HTTP ${response.status}`);
      }
    },
  };
}

export function createHttpInvoicingAdapter(
  baseUrl: string,
  apiKey?: string,
): InvoicingAdapter {
  const headers: Record<string, string> = apiKey
    ? { authorization: `Bearer ${apiKey}` }
    : {};

  return {
    async createInvoice(request: InvoiceRequest) {
      const response = await fetchWithPolicy(
        "invoicing",
        "create-invoice",
        `${baseUrl}/invoices`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...headers,
          },
          body: JSON.stringify(request),
        },
      );

      if (!response.ok) {
        throw new Error(`Invoicing provider error: HTTP ${response.status}`);
      }

      const invoice = await safeJson<InvoiceRecord>(response);

      if (!invoice) {
        throw new Error("Invoicing provider returned invalid response");
      }

      return invoice;
    },
    async getInvoice(invoiceId: string) {
      const response = await fetchWithPolicy(
        "invoicing",
        "get-invoice",
        `${baseUrl}/invoices/${invoiceId}`,
        {
          headers,
        },
      );

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        throw new Error(`Invoicing provider error: HTTP ${response.status}`);
      }

      return safeJson<InvoiceRecord>(response);
    },
    async listInvoices() {
      const response = await fetchWithPolicy(
        "invoicing",
        "list-invoices",
        `${baseUrl}/invoices`,
        {
          headers,
        },
      );

      if (!response.ok) {
        throw new Error(`Invoicing provider error: HTTP ${response.status}`);
      }

      return (await safeJson<InvoiceRecord[]>(response)) ?? [];
    },
  };
}
