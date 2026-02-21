import { createHmac, timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";

export type AppRole = "technician" | "dispatcher" | "manager" | "admin";

export type AuthContext = {
  userId: string;
  role: AppRole;
  tenantId: string;
  authType: "demo" | "jwt" | "fallback" | "dev-bypass";
};

const VALID_ROLES: AppRole[] = ["technician", "dispatcher", "manager", "admin"];

function parseRole(role: string | null | undefined): AppRole | null {
  if (!role) {
    return null;
  }

  return VALID_ROLES.includes(role as AppRole) ? (role as AppRole) : null;
}

function parseBooleanEnv(name: string, fallback: boolean) {
  const configured = process.env[name];

  if (configured === undefined) {
    return fallback;
  }

  const normalized = configured.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function allowDemoToken() {
  return parseBooleanEnv(
    "AUTH_ALLOW_DEMO_TOKEN",
    process.env.NODE_ENV !== "production",
  );
}

function parseTenantId(value: string | null | undefined) {
  return value?.trim() || "default";
}

type JwtPayload = {
  sub?: string;
  userId?: string;
  role?: string;
  tenantId?: string;
  iss?: string;
  exp?: number;
  nbf?: number;
};

function base64UrlToBase64(value: string) {
  return value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
}

function decodeBase64UrlJson<T>(value: string): T | null {
  try {
    const json = Buffer.from(base64UrlToBase64(value), "base64").toString(
      "utf8",
    );
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

function parseJwtToken(token: string): AuthContext | null {
  const jwtSecret = process.env.AUTH_JWT_SECRET;

  if (!jwtSecret) {
    return null;
  }

  const parts = token.split(".");

  if (parts.length !== 3) {
    return null;
  }

  const [headerPart, payloadPart, signaturePart] = parts;
  const header = decodeBase64UrlJson<{ alg?: string; typ?: string }>(
    headerPart,
  );
  const payload = decodeBase64UrlJson<JwtPayload>(payloadPart);

  if (!header || !payload || header.alg !== "HS256") {
    return null;
  }

  const signingInput = `${headerPart}.${payloadPart}`;
  const expectedSignature = createHmac("sha256", jwtSecret)
    .update(signingInput)
    .digest("base64url");

  const given = Buffer.from(signaturePart, "utf8");
  const expected = Buffer.from(expectedSignature, "utf8");

  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return null;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);

  if (typeof payload.nbf === "number" && payload.nbf > nowSeconds) {
    return null;
  }

  if (typeof payload.exp === "number" && payload.exp <= nowSeconds) {
    return null;
  }

  const requiredIssuer = process.env.AUTH_JWT_ISSUER;
  if (requiredIssuer && payload.iss !== requiredIssuer) {
    return null;
  }

  const role = parseRole(payload.role ?? null);
  const userId = payload.sub ?? payload.userId;

  if (!role || !userId) {
    return null;
  }

  return {
    role,
    userId,
    tenantId: parseTenantId(payload.tenantId),
    authType: "jwt",
  };
}

function parseDemoToken(token: string): AuthContext | null {
  if (!allowDemoToken()) {
    return null;
  }

  // Demo token format: "role:userId[:tenantId]"
  const [roleRaw, userId, tenantId] = token.split(":");
  const role = parseRole(roleRaw);

  if (!role || !userId) {
    return null;
  }

  return {
    role,
    userId,
    tenantId: parseTenantId(tenantId),
    authType: "demo",
  };
}

function parseAuthorizationHeader(value: string | null): AuthContext | null {
  if (!value) {
    return null;
  }

  const [scheme, token] = value.split(" ");

  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    return null;
  }

  const jwtAuth = parseJwtToken(token);

  if (jwtAuth) {
    return jwtAuth;
  }

  return parseDemoToken(token);
}

function parseFallbackHeaders(c: Context): AuthContext | null {
  const role = parseRole(c.req.header("x-role") ?? c.req.query("role"));
  const userId = c.req.header("x-user-id") ?? c.req.query("userId");
  const tenantId = parseTenantId(
    c.req.header("x-tenant-id") ?? c.req.query("tenantId"),
  );

  if (!role || !userId) {
    return null;
  }

  return {
    role,
    userId,
    tenantId,
    authType: "fallback",
  };
}

function allowQueryFallback() {
  const configured = process.env.AUTH_ALLOW_QUERY_FALLBACK;

  if (configured !== undefined) {
    const normalized = configured.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes";
  }

  return process.env.NODE_ENV !== "production";
}

export function getAuth(c: Context): AuthContext {
  const auth = c.get("auth") as AuthContext | undefined;

  if (!auth) {
    throw new Error("Auth context missing");
  }

  return auth;
}

export function requireAuth(): MiddlewareHandler {
  return async (c, next) => {
    const authRequired =
      (process.env.AUTH_REQUIRED ?? "true").toLowerCase() !== "false";

    if (!authRequired) {
      c.set("auth", {
        role: "admin",
        userId: "dev-bypass",
        tenantId: "dev",
        authType: "dev-bypass",
      } satisfies AuthContext);
      await next();
      return;
    }

    const authFromHeader = parseAuthorizationHeader(
      c.req.header("authorization") ?? null,
    );
    const fallbackAuth = allowQueryFallback() ? parseFallbackHeaders(c) : null;
    const auth = authFromHeader ?? fallbackAuth;

    if (!auth) {
      return c.json(
        {
          error: "Unauthorized",
          hint: "Use Authorization: Bearer <role:userId[:tenantId]> (demo), Bearer <jwt> (HS256), or x-role/x-user-id headers",
        },
        401,
      );
    }

    c.header("x-tenant-id", auth.tenantId);
    c.set("auth", auth);
    await next();
  };
}

export function ensureRole(c: Context, allowed: AppRole[]) {
  const auth = getAuth(c);

  if (!allowed.includes(auth.role)) {
    return c.json(
      {
        error: "Forbidden",
        requiredRoles: allowed,
        currentRole: auth.role,
      },
      403,
    );
  }

  return null;
}
