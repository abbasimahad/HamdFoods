import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Decimal from "decimal.js";
import { Client } from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { findOrOpenAccountingPeriod } from "@/server/accounting/accounting-periods";
import { inventoryValuation, reportAsOf } from "@/server/accounting/financial-reporting";
import { prisma } from "@/server/db/prisma";
import {
  createBackup,
  resolvePostgresTool,
  restoreLiveDatabase,
} from "@/server/operations/database-backup";
import { PrismaProductionBatchRepository } from "@/server/production/prisma-production-batch-repository";
import { PrismaProductionMaterialRepository } from "@/server/production/prisma-production-material-repository";
import { PrismaCustomerPaymentRepository } from "@/server/sales/prisma-customer-payment-repository";
import { executePhase27GoldenWorkflow, type Phase27WorkflowState } from "./phase27-golden-workflow";

let state: Phase27WorkflowState;

beforeAll(async () => {
  state = await executePhase27GoldenWorkflow();
});

async function valuationBalance(itemId: string) {
  const row = await prisma.inventoryValuationBalance.findUniqueOrThrow({ where: { itemId } });
  return {
    quantity: new Decimal(row.ownedQuantity.toString()),
    value: new Decimal(row.inventoryValue.toString()),
  };
}

async function ledger(itemId: string, where: Record<string, unknown>) {
  const total = await prisma.inventoryMovement.aggregate({
    where: { itemId, ...where },
    _sum: { quantity: true },
  });
  return new Decimal(total._sum.quantity?.toString() ?? "0");
}

describe("round-4 bug-log regressions", () => {
  it("BUG-31: a posted consumption and issue are reversed at cost while the batch is open", async () => {
    const batches = new PrismaProductionBatchRepository();
    const materials = new PrismaProductionMaterialRepository();
    const grams = await prisma.unit.findFirstOrThrow({ where: { code: "G" } });
    const batchId = await batches.createBatch({
      recipeId: state.recipeId,
      plannedBatchQuantity: "1000",
      plannedBatchUnitId: grams.id,
      plannedProductionDate: "2026-06-10",
      targetCompletionDate: "2026-06-11",
      rawMaterialWarehouseId: state.sourceWarehouseId,
      packagingWarehouseId: state.sourceWarehouseId,
      finishedGoodsDestinationWarehouseId: state.sourceWarehouseId,
      plannedCartons: "0",
      plannedLoosePieces: "2",
      notes: "BUG-31 reversal regression batch.",
      actorUserId: state.actorUserId,
    });
    await batches.planBatch(batchId, state.actorUserId);
    await batches.releaseBatch(batchId, state.actorUserId, true);
    const requirement = (await batches.getBatch(batchId))?.materialRequirements[0];
    expect(requirement).toBeDefined();
    const lotBalances = await prisma.inventoryMovement.groupBy({
      by: ["inventoryLotId"],
      where: {
        itemId: state.rawItemId,
        warehouseId: state.sourceWarehouseId,
        status: "AVAILABLE",
        inventoryLotId: { not: null },
      },
      _sum: { quantity: true },
    });
    const lot = lotBalances.find((row) => new Decimal(row._sum.quantity?.toString() ?? 0).gte(3));
    expect(lot?.inventoryLotId).toBeTruthy();
    const inventoryLotId = lot!.inventoryLotId!;

    const availableBefore = await ledger(state.rawItemId, {
      warehouseId: state.sourceWarehouseId,
      status: "AVAILABLE",
      inventoryLotId,
    });
    const issueId = await materials.createTransaction({
      productionBatchId: batchId,
      transactionType: "ISSUE",
      transactionDate: "2026-06-10T08:00",
      batchRequirementId: requirement!.id,
      inventoryLotId,
      quantity: "3",
      unitId: grams.id,
      actorUserId: state.actorUserId,
    });
    await materials.postTransaction(issueId, state.actorUserId);
    const consumptionId = await materials.createTransaction({
      productionBatchId: batchId,
      transactionType: "CONSUMPTION",
      transactionDate: "2026-06-10T09:00",
      batchRequirementId: requirement!.id,
      inventoryLotId,
      quantity: "3",
      unitId: grams.id,
      actorUserId: state.actorUserId,
    });
    const beforeConsumption = await valuationBalance(state.rawItemId);
    await materials.postTransaction(consumptionId, state.actorUserId);
    const consumptionCost = await prisma.inventoryValuationEntry.findFirstOrThrow({
      where: { sourceId: consumptionId, entryType: "PRODUCTION_CONSUMPTION" },
    });

    const reversalId = await materials.reverseTransaction(
      consumptionId,
      state.actorUserId,
      "Wrong quantity consumed in error",
    );
    const reversal = await prisma.productionMaterialTransaction.findUniqueOrThrow({
      where: { id: reversalId },
    });
    expect(reversal.status).toBe("POSTED");
    expect(reversal.reversalOfId).toBe(consumptionId);
    // The original stays POSTED and immutable; the reversal restores exactly its value.
    expect(
      (
        await prisma.productionMaterialTransaction.findUniqueOrThrow({
          where: { id: consumptionId },
        })
      ).status,
    ).toBe("POSTED");
    const restored = await prisma.inventoryValuationEntry.findFirstOrThrow({
      where: { sourceId: reversalId },
    });
    expect(new Decimal(restored.valueDelta!.toString()).toFixed(6)).toBe(
      new Decimal(consumptionCost.valueDelta!.toString()).negated().toFixed(6),
    );
    const afterReversal = await valuationBalance(state.rawItemId);
    expect(afterReversal.quantity.toFixed()).toBe(beforeConsumption.quantity.toFixed());
    expect(afterReversal.value.toFixed(6)).toBe(beforeConsumption.value.toFixed(6));
    // WIP is relieved by the same amount it was charged.
    const journals = await prisma.accountingJournal.findMany({
      where: { sourceId: { in: [consumptionCost.id, restored.id] }, status: "POSTED" },
      include: { lines: true },
    });
    expect(journals).toHaveLength(2);
    const wip = await prisma.accountingAccountMapping.findFirstOrThrow({
      where: { accountingSettingsId: "default", mappingKey: "WORK_IN_PROCESS" },
    });
    const wipNet = journals
      .flatMap((journal) => journal.lines)
      .filter((line) => line.accountId === wip.accountId)
      .reduce(
        (total, line) => total.add(line.debit.toString()).sub(line.credit.toString()),
        new Decimal(0),
      );
    expect(wipNet.toFixed(2)).toBe("0.00");

    const view = await materials.getBatchMaterialView(batchId);
    const line = view!.requirements.find((entry) => entry.itemId === state.rawItemId)!;
    expect(new Decimal(line.cumulativeConsumed).toFixed()).toBe("0");
    expect(new Decimal(line.currentlyInProduction).toFixed()).toBe("3");
    await expect(
      materials.reverseTransaction(consumptionId, state.actorUserId, "Second reversal attempt"),
    ).rejects.toThrow(/already reversed/);

    // The (now unconsumed) issue can be reversed too: custody goes back to AVAILABLE.
    await materials.reverseTransaction(issueId, state.actorUserId, "Issued from the wrong lot");
    const afterIssueReversal = await materials.getBatchMaterialView(batchId);
    const issued = afterIssueReversal!.requirements.find(
      (entry) => entry.itemId === state.rawItemId,
    )!;
    expect(new Decimal(issued.cumulativeIssued).toFixed()).toBe("0");
    expect(new Decimal(issued.currentlyInProduction).toFixed()).toBe("0");
    expect(
      (
        await ledger(state.rawItemId, {
          warehouseId: state.sourceWarehouseId,
          status: "AVAILABLE",
          inventoryLotId,
        })
      ).toFixed(),
    ).toBe(availableBefore.toFixed());
  });

  it("BUG-31: a completed batch's consumption cannot be reversed", async () => {
    const materials = new PrismaProductionMaterialRepository();
    const consumption = await prisma.productionMaterialTransaction.findFirstOrThrow({
      where: {
        productionBatchId: state.batchId,
        materialType: "RAW_MATERIAL",
        transactionType: "CONSUMPTION",
        status: "POSTED",
      },
    });
    await expect(
      materials.reverseTransaction(consumption.id, state.actorUserId, "Too late to correct this"),
    ).rejects.toThrow(/still in progress/);
  });

  it("BUG-25: the same cheque number cannot be recorded twice for a customer", async () => {
    const payments = new PrismaCustomerPaymentRepository();
    const cheque = `CHQ-R4-${Date.now()}`;
    const input = {
      customerId: state.customerId,
      paymentDate: "2026-06-12",
      method: "CHEQUE" as const,
      totalAmount: "10",
      bankName: "Test Bank",
      chequeNumber: cheque,
      chequeDate: "2026-06-12",
      allocations: [],
      actorUserId: state.actorUserId,
    };
    const first = await payments.createCustomerPayment({ ...input, referenceNumber: "R4-A" });
    await expect(
      payments.createCustomerPayment({
        ...input,
        referenceNumber: "R4-B",
        chequeNumber: ` ${cheque.toLowerCase()} `,
      }),
    ).rejects.toThrow(/Cheque .* is already recorded/);
    expect(first).toBeTruthy();
  });

  it("BUG-30: the valuation report equals the authoritative balances regardless of entry order", async () => {
    const report = await inventoryValuation(reportAsOf());
    const balances = await prisma.inventoryValuationBalance.findMany({ include: { item: true } });
    for (const row of report.summary) {
      const expected = balances
        .filter((balance) => balance.item.itemType === row.type)
        .reduce((total, balance) => total.add(balance.inventoryValue.toString()), new Decimal(0));
      expect(new Decimal(row.valuation).toFixed(6)).toBe(expected.toFixed(6));
    }
  });

  it("INST-6: the first posting of a month with no period opens that calendar month", async () => {
    // Runs in a rolled-back transaction so the disposable database keeps its period layout.
    const rollback = new Error("rollback");
    const today = new Date();
    const nextMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 5));
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.accountingPeriod.deleteMany({
          where: {
            startDate: {
              lte: new Date(Date.UTC(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth() + 1, 0)),
            },
            endDate: {
              gte: new Date(Date.UTC(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth(), 1)),
            },
            events: { none: {} },
          },
        });
        const covering = await tx.accountingPeriod.count({
          where: { startDate: { lte: nextMonth }, endDate: { gte: nextMonth } },
        });
        const period = await findOrOpenAccountingPeriod(tx, nextMonth, state.actorUserId);
        if (covering === 0) {
          expect(period?.status).toBe("OPEN");
          expect(period?.startDate.toISOString().slice(0, 10)).toBe(
            new Date(Date.UTC(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth(), 1))
              .toISOString()
              .slice(0, 10),
          );
        }
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });

  it("INST-9: a live restore swaps in a verified backup and keeps the replaced data", async () => {
    const owner = "r4_restore_owner";
    const live = "r4_live_restore";
    const ownerPassword = "r4-restore-test-only";
    const server = new URL(process.env.DATABASE_URL!);
    const adminUrl = `postgresql://postgres@${server.host}/postgres`;
    const ownerUrl = `postgresql://${owner}:${ownerPassword}@${server.host}/${live}`;
    const directory = mkdtempSync(path.join(tmpdir(), "r4-live-restore-"));
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    const cleanup = async () => {
      const leftovers = await admin.query<{ datname: string }>(
        "SELECT datname FROM pg_database WHERE datname LIKE $1",
        [`${live}%`],
      );
      for (const { datname } of leftovers.rows) {
        await admin.query(`ALTER DATABASE "${datname}" WITH ALLOW_CONNECTIONS true`);
        await admin.query(`DROP DATABASE "${datname}" WITH (FORCE)`);
      }
      await admin.query(`DROP ROLE IF EXISTS ${owner}`);
    };
    try {
      await cleanup();
      await admin.query(`CREATE ROLE ${owner} LOGIN PASSWORD '${ownerPassword}'`);
      await admin.query(`CREATE DATABASE ${live} OWNER ${owner}`);
      // Build an installation-like copy of the test database owned by its own role.
      const source = await createBackup({
        databaseUrl: process.env.DATABASE_URL!,
        backupDirectory: directory,
        retention: false,
      });
      const copy = spawnSync(
        resolvePostgresTool("pg_restore"),
        [
          "--exit-on-error",
          "--single-transaction",
          "--no-owner",
          "--no-privileges",
          `--host=${server.hostname}`,
          `--port=${server.port}`,
          `--username=${owner}`,
          `--dbname=${live}`,
          source.dumpPath,
        ],
        { env: { ...process.env, PGPASSWORD: ownerPassword }, encoding: "utf8" },
      );
      expect(copy.status, copy.stderr).toBe(0);
      const baseline = await createBackup({
        databaseUrl: ownerUrl,
        backupDirectory: directory,
        retention: false,
      });

      // Change the "live" data after the baseline was taken.
      const client = new Client({ connectionString: ownerUrl });
      await client.connect();
      await client.query(`UPDATE item SET name = 'R4 changed after backup' WHERE code = 'P27-RAW'`);
      await client.end();

      // A backup of a different database is refused before anything changes.
      await expect(
        restoreLiveDatabase({
          backupIdentifier: source.manifest.backupId,
          backupDirectory: directory,
          databaseUrl: ownerUrl,
          adminPassword: "",
        }),
      ).rejects.toThrow(/not this installation's/);

      const result = await restoreLiveDatabase({
        backupIdentifier: baseline.manifest.backupId,
        backupDirectory: directory,
        databaseUrl: ownerUrl,
        adminPassword: "",
      });
      expect(result.targetDatabaseName).toBe(live);
      const { expectedTables, migrationsMatch, factsMatch, auditPreserved } = result.integrity;
      expect([expectedTables, migrationsMatch, factsMatch, auditPreserved]).toEqual([
        true,
        true,
        true,
        true,
      ]);
      const restored = new Client({ connectionString: ownerUrl });
      await restored.connect();
      const name = await restored.query<{ name: string }>(
        "SELECT name FROM item WHERE code = 'P27-RAW'",
      );
      // The restored database is owned by the installation role, so the ERP can write to it.
      const owned = await restored.query<{ owner: string }>(
        "SELECT tableowner AS owner FROM pg_tables WHERE tablename = 'item'",
      );
      await restored.end();
      expect(name.rows[0]?.name).not.toBe("R4 changed after backup");
      expect(owned.rows[0]?.owner).toBe(owner);
      const kept = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [
        result.previousDatabaseName,
      ]);
      expect(kept.rowCount).toBe(1);
    } finally {
      await cleanup();
      await admin.end();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
