type MobileOperationType =
  | "start_job"
  | "complete_job"
  | "update_checklist"
  | "add_proof";

type QueuedMobileOperation = {
  clientOperationId: string;
  type: MobileOperationType;
  payload: Record<string, unknown>;
  queuedAt: string;
};

const STORAGE_KEY = "servicenova.mobile.offlineQueue";

function isBrowserRuntime() {
  return (
    typeof window !== "undefined" && typeof window.localStorage !== "undefined"
  );
}

function readQueue(): QueuedMobileOperation[] {
  if (!isBrowserRuntime()) {
    return [];
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);

  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as QueuedMobileOperation[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: QueuedMobileOperation[]) {
  if (!isBrowserRuntime()) {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(queue.slice(-500)));
}

export function enqueueMobileOperation(
  type: MobileOperationType,
  payload: Record<string, unknown>,
) {
  const queue = readQueue();
  queue.push({
    clientOperationId: `mob-${crypto.randomUUID()}`,
    type,
    payload,
    queuedAt: new Date().toISOString(),
  });
  writeQueue(queue);
}

export async function flushMobileQueue(authToken: string) {
  const queue = readQueue();

  if (queue.length === 0 || !isBrowserRuntime()) {
    return { flushed: 0, remaining: 0 };
  }

  try {
    const response = await fetch("/api/field/mobile/sync", {
      method: "POST",
      headers: {
        authorization: authToken,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        operations: queue,
      }),
    });

    if (!response.ok) {
      return { flushed: 0, remaining: queue.length };
    }

    const payload = (await response.json()) as {
      results?: Array<{ clientOperationId: string; ok: boolean }>;
    };
    const succeeded = new Set(
      (payload.results ?? [])
        .filter((item) => item.ok)
        .map((item) => item.clientOperationId),
    );
    const remaining = queue.filter(
      (item) => !succeeded.has(item.clientOperationId),
    );
    writeQueue(remaining);

    return {
      flushed: queue.length - remaining.length,
      remaining: remaining.length,
    };
  } catch {
    return { flushed: 0, remaining: queue.length };
  }
}
