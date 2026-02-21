import { Hono } from "hono";
import { requireAuth } from "./auth";
import { startBackgroundJobsRuntime } from "./background-jobs";
import { configureFieldOpsPersistenceFromEnv } from "./db/persistence";
import { requestTracing } from "./observability";
import { fieldRoutes } from "./routes/field";

export function createApp() {
  const app = new Hono();

  void configureFieldOpsPersistenceFromEnv().finally(() => {
    startBackgroundJobsRuntime();
  });
  app.use("*", requestTracing());
  app.use("/api/field/*", requireAuth());

  app.onError((error, c) => {
    const requestId =
      c.req.header("x-request-id") ?? `req-${crypto.randomUUID()}`;
    c.header("x-request-id", requestId);

    if (process.env.NODE_ENV !== "test" && process.env.VITEST !== "true") {
      console.error(
        `[error] ${JSON.stringify({
          requestId,
          method: c.req.method,
          path: c.req.path,
          message: error.message,
        })}`,
      );
    }

    return c.json(
      {
        error: "Internal server error",
        requestId,
      },
      500,
    );
  });

  app.get("/api/health", (c) => c.json({ ok: true, app: "servicenova-ai" }));
  app.get("/api/ai/field/intelligence", (c) =>
    c.json({
      ok: true,
      entrypoint: "/api/field/jobs/:jobId/intelligence",
      message: "Use field intelligence endpoints for work-order AI analysis.",
    }),
  );
  app.route("/api/field", fieldRoutes);

  return app;
}
