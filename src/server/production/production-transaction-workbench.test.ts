import { describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ count: vi.fn(), findMany: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/prisma", () => ({
  prisma: {
    productionMaterialTransaction: { count: db.count, findMany: db.findMany },
    productionBatch: { findMany: db.findMany },
  },
}));
import { PrismaProductionTransactionWorkbench } from "./prisma-production-transaction-workbench";
describe("production transaction workbench", () => {
  it("maps existing transactions without mutation", async () => {
    db.count.mockResolvedValueOnce(1);
    db.findMany.mockResolvedValueOnce([
      {
        id: "tx",
        transactionNumber: "MI-1",
        productionBatchId: "batch",
        transactionType: "ISSUE",
        status: "POSTED",
        transactionDate: new Date("2026-01-01"),
        productionBatch: { batchNumber: "B-1", finishedGood: { code: "FG", name: "Food" } },
      },
    ]);
    const page = await new PrismaProductionTransactionWorkbench().list("material", {
      query: "B-1",
      page: 1,
    });
    expect(page.records[0]).toMatchObject({ number: "MI-1", batchNumber: "B-1", type: "ISSUE" });
    expect(db.findMany).toHaveBeenCalledOnce();
  });
  it("restricts eligible packaging to in-progress batches", async () => {
    db.findMany.mockResolvedValueOnce([]);
    await new PrismaProductionTransactionWorkbench().eligibleBatches("packaging");
    expect(db.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: { in: ["IN_PROGRESS"] } } }),
    );
  });
});
