import "server-only";
import type {
  EligibleProductionBatch,
  ProductionTransactionPage,
  ProductionTransactionQuery,
} from "@/modules/production/application/transaction-workbench-contracts";
import type { ProductionTransactionKind } from "@/modules/production/application/transaction-workbench-routing";
import { prisma } from "@/server/db/prisma";
const PAGE_SIZE = 30;
export class PrismaProductionTransactionWorkbench {
  async list(
    kind: ProductionTransactionKind,
    query: ProductionTransactionQuery,
  ): Promise<ProductionTransactionPage> {
    const page = Math.max(1, Math.trunc(query.page) || 1);
    const where = {
      materialType:
        kind === "material" ? ("RAW_MATERIAL" as const) : ("PACKAGING_MATERIAL" as const),
      ...(query.type ? { transactionType: query.type as "ISSUE" } : {}),
      ...(query.status ? { status: query.status as "DRAFT" } : {}),
      ...(query.query
        ? {
            OR: [
              { transactionNumber: { contains: query.query, mode: "insensitive" as const } },
              {
                productionBatch: {
                  batchNumber: { contains: query.query, mode: "insensitive" as const },
                },
              },
              {
                productionBatch: {
                  finishedGood: { name: { contains: query.query, mode: "insensitive" as const } },
                },
              },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.productionMaterialTransaction.count({ where }),
      prisma.productionMaterialTransaction.findMany({
        where,
        include: { productionBatch: { include: { finishedGood: true } } },
        orderBy: [{ transactionDate: "desc" }, { transactionNumber: "desc" }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
    ]);
    return {
      records: rows.map((row) => ({
        id: row.id,
        number: row.transactionNumber,
        batchId: row.productionBatchId,
        batchNumber: row.productionBatch.batchNumber,
        product: `${row.productionBatch.finishedGood.code} · ${row.productionBatch.finishedGood.name}`,
        type: row.transactionType,
        status: row.status,
        date: row.transactionDate,
      })),
      page,
      pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      total,
    };
  }
  async eligibleBatches(
    kind: ProductionTransactionKind,
  ): Promise<readonly EligibleProductionBatch[]> {
    const statuses =
      kind === "material" ? (["RELEASED", "IN_PROGRESS"] as const) : (["IN_PROGRESS"] as const);
    const rows = await prisma.productionBatch.findMany({
      where: { status: { in: [...statuses] } },
      include: { finishedGood: true },
      orderBy: { batchNumber: "desc" },
      take: 500,
    });
    return rows.map((row) => ({
      id: row.id,
      number: row.batchNumber,
      status: row.status,
      product: `${row.finishedGood.code} · ${row.finishedGood.name}`,
    }));
  }
}
