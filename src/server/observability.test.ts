import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  getObservabilitySnapshot,
  requestTracing,
  resetObservabilityForTests,
} from "./observability";

describe("observability metrics", () => {
  it("captures request samples and computes snapshot stats", async () => {
    resetObservabilityForTests();
    const app = new Hono();
    app.use("*", requestTracing());
    app.get("/ok", (c) => c.json({ ok: true }));
    app.get("/boom", (c) => c.json({ error: true }, 500));

    await app.request("/ok");
    await app.request("/ok");
    await app.request("/boom");

    const snapshot = getObservabilitySnapshot({ windowMinutes: 60 });
    expect(snapshot.totalRequests).toBeGreaterThanOrEqual(3);
    expect(snapshot.routes.length).toBeGreaterThan(0);
    expect(snapshot.errorRate).toBeGreaterThan(0);
  });
});
