import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import { executePhase27GoldenWorkflow } from "./phase27-golden-workflow";

beforeAll(async () => {
  await executePhase27GoldenWorkflow();
});

describe("dedicated integration database", () => {
  afterAll(async () => prisma.$disconnect());

  it("connects only to the guarded test database and exposes the migrated core schema", async () => {
    const [database] = await prisma.$queryRaw<Array<{ database: string }>>`
      SELECT current_database() AS database
    `;
    const [schema] = await prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT to_regclass('public.inventory_movement') IS NOT NULL AS exists
    `;
    expect(database?.database).toMatch(/(?:^|[-_])test(?:$|[-_])/i);
    expect(schema?.exists).toBe(true);
  });

  it("loads transaction relations without overlapping an unsupported pg client", async () => {
    const warnings: string[] = [];
    const warningListener = (warning: Error) => warnings.push(warning.message);
    process.on("warning", warningListener);

    try {
      await prisma.$transaction((transaction) =>
        transaction.goodsReceipt.findFirstOrThrow({
          include: {
            purchaseOrder: {
              include: { lines: { include: { item: true, canonicalUnit: true } }, supplier: true },
            },
            warehouse: true,
            lines: { orderBy: { position: "asc" } },
          },
        }),
      );
      await new Promise<void>((resolve) => setImmediate(resolve));
    } finally {
      process.off("warning", warningListener);
    }

    expect(warnings).not.toContain(
      "Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0. Use async/await or an external async flow control mechanism instead.",
    );
  });
});
