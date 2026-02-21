import { describe, expect, it, vi } from "vitest";
import { DrizzleRateLimitRepository } from "./rate-limit-repository";

describe("DrizzleRateLimitRepository", () => {
  it("increments and returns normalized counter values", async () => {
    const returning = vi
      .fn()
      .mockResolvedValueOnce([
        { hitCount: 2, resetAt: new Date("2026-02-15T08:00:00.000Z") },
      ])
      .mockResolvedValueOnce([
        { hitCount: 1, resetAt: "2026-02-15T09:00:00.000Z" },
      ]);
    const onConflictDoUpdate = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const insert = vi.fn(() => ({ values }));
    const where = vi.fn().mockResolvedValue(undefined);
    const deleteFn = vi.fn(() => ({ where }));

    const repository = new DrizzleRateLimitRepository({
      insert,
      delete: deleteFn,
    });

    const scopeKey = "mutation:tenant-a:manager:u1:/api/field/jobs/assign";
    const first = await repository.increment(scopeKey, 60_000, Date.now());
    const second = await repository.increment(scopeKey, 60_000, Date.now());

    expect(first.count).toBe(2);
    expect(first.resetAt).toBe(Date.parse("2026-02-15T08:00:00.000Z"));
    expect(second.count).toBe(1);
    expect(second.resetAt).toBe(Date.parse("2026-02-15T09:00:00.000Z"));

    expect(insert).toHaveBeenCalledTimes(2);
    expect(values).toHaveBeenCalledTimes(2);
    expect(onConflictDoUpdate).toHaveBeenCalledTimes(2);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ scopeKey, tenantId: "tenant-a" }),
    );
  });

  it("runs cleanup with expiry predicate", async () => {
    const returning = vi
      .fn()
      .mockResolvedValue([{ hitCount: 1, resetAt: new Date() }]);
    const onConflictDoUpdate = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const insert = vi.fn(() => ({ values }));
    const where = vi.fn().mockResolvedValue(undefined);
    const deleteFn = vi.fn(() => ({ where }));

    const repository = new DrizzleRateLimitRepository({
      insert,
      delete: deleteFn,
    });

    await repository.cleanup(Date.now());

    expect(deleteFn).toHaveBeenCalledTimes(1);
    expect(where).toHaveBeenCalledTimes(1);
  });
});
