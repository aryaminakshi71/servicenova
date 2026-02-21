import { describe, expect, it, vi } from "vitest";
import { DrizzleIdempotencyRepository } from "./idempotency-repository";

describe("DrizzleIdempotencyRepository", () => {
  it("stores records with tenant_id derived from scope", async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn(() => ({ execute }));
    const insert = vi.fn(() => ({ values }));
    const where = vi.fn().mockResolvedValue(undefined);
    const deleteFn = vi.fn(() => ({ where }));

    const repository = new DrizzleIdempotencyRepository({
      insert,
      delete: deleteFn,
    });

    await repository.set("tenant-a:assign-job:user-1:hash:key-1", {
      status: 202,
      body: { ok: true },
      createdAt: Date.now(),
    });

    expect(deleteFn).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-a",
        scopeKey: "tenant-a:assign-job:user-1:hash:key-1",
      }),
    );
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("returns the newest matching record", async () => {
    const rows = [
      {
        responseStatus: 202,
        responseBody: { id: "older" },
        createdAt: "2026-02-15T08:00:00.000Z",
      },
      {
        responseStatus: 200,
        responseBody: { id: "newer" },
        createdAt: "2026-02-15T09:00:00.000Z",
      },
    ];
    const where = vi.fn().mockResolvedValue(rows);
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const insert = vi.fn(() => ({
      values: vi.fn(() => ({ execute: vi.fn() })),
    }));
    const deleteFn = vi.fn(() => ({ where: vi.fn() }));

    const repository = new DrizzleIdempotencyRepository({
      select,
      insert,
      delete: deleteFn,
    });

    const result = await repository.get(
      "tenant-b:route-plan:user-2:hash:key-2",
    );

    expect(result?.status).toBe(200);
    expect(result?.body).toEqual({ id: "newer" });
    expect(select).toHaveBeenCalledTimes(1);
  });
});
