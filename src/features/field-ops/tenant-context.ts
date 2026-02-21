const DEFAULT_TENANT_ID = "default";
const fallbackTenantStack: string[] = [];

type TenantContextStore = {
  getStore(): string | undefined;
  run<T>(tenantId: string, handler: () => T): T;
};

function createTenantContextStore(): TenantContextStore | null {
  try {
    if (typeof process === "undefined" || !process.versions?.node) {
      return null;
    }

    const dynamicRequire = Function("return require")() as (
      id: string,
    ) => unknown;
    const asyncHooks = dynamicRequire("node:async_hooks") as {
      AsyncLocalStorage: new <T>() => TenantContextStore;
    };

    return new asyncHooks.AsyncLocalStorage<string>();
  } catch {
    return null;
  }
}

const tenantContext = createTenantContextStore();

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

export function currentTenantId() {
  if (tenantContext) {
    return tenantContext.getStore() ?? DEFAULT_TENANT_ID;
  }

  return (
    fallbackTenantStack[fallbackTenantStack.length - 1] ?? DEFAULT_TENANT_ID
  );
}

export function runWithTenantContext<T>(tenantId: string, handler: () => T): T {
  const normalized = tenantId.trim() || DEFAULT_TENANT_ID;

  if (tenantContext) {
    return tenantContext.run(normalized, handler);
  }

  fallbackTenantStack.push(normalized);

  try {
    const result = handler();

    if (isPromiseLike(result)) {
      return result.finally(() => {
        fallbackTenantStack.pop();
      }) as T;
    }

    fallbackTenantStack.pop();
    return result;
  } catch (error) {
    fallbackTenantStack.pop();
    throw error;
  }
}
