import Decimal from "decimal.js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  postProductionMaterialInventory,
  postPurchaseReceiptInventory,
  postReceiptQcInventory,
  postSalesDispatchInventory,
  postSalesInvoiceOutflowInventory,
  postSalesOrderReservationInventory,
} from "./transactional-inventory-posting";

const reservationCommand = {
  operation: "RESERVE" as const,
  salesOrderId: "order-1",
  salesOrderNumber: "SO-1",
  salesOrderLineId: "order-line-1",
  itemId: "item-1",
  warehouseId: "warehouse-1",
  canonicalUnitId: "unit-pcs",
  quantity: "200",
  actorUserId: "actor-1",
};

describe("inventory reservation and dispatch", () => {
  it("moves AVAILABLE to RESERVED without changing physical quantity", async () => {
    const tx = finishedGoodsTx({ available: "500", reserved: "0" });
    await postSalesOrderReservationInventory(tx.client, [reservationCommand]);

    const movements = tx.created();
    expect(movements).toMatchObject([
      { status: "AVAILABLE", quantity: "-200" },
      { status: "RESERVED", quantity: "200" },
    ]);
    expect(total(movements)).toBe("0");
  });

  it("rejects insufficient stock before writing any reservation movement", async () => {
    const tx = finishedGoodsTx({ available: "100", reserved: "0" });
    await expect(
      postSalesOrderReservationInventory(tx.client, [{ ...reservationCommand, quantity: "101" }]),
    ).rejects.toMatchObject({ reason: "stock" });
    expect(tx.createMany).not.toHaveBeenCalled();
  });

  it("moves a partial dispatch from RESERVED to IN_TRANSIT", async () => {
    const tx = finishedGoodsTx({ available: "500", reserved: "200" });
    await postSalesDispatchInventory(tx.client, [
      {
        salesDispatchId: "dispatch-1",
        salesDispatchNumber: "DN-1",
        salesDispatchLineId: "dispatch-line-1",
        salesDispatchAllocationId: "allocation-1",
        salesOrderId: "order-1",
        salesOrderLineId: "order-line-1",
        itemId: "item-1",
        warehouseId: "warehouse-1",
        canonicalUnitId: "unit-pcs",
        productionLotId: "lot-1",
        quantity: "80",
        dispatchAt: new Date("2026-01-15T00:00:00.000Z"),
        actorUserId: "actor-1",
      },
    ]);
    const movements = tx.created();
    expect(movements).toMatchObject([
      { status: "RESERVED", quantity: "-80" },
      { status: "IN_TRANSIT", quantity: "80" },
    ]);
    expect(total(movements)).toBe("0");
  });

  it("rejects an expired production lot before writing dispatch movements", async () => {
    const tx = finishedGoodsTx({
      available: "500",
      reserved: "200",
      expiryDate: new Date("2026-01-14T00:00:00.000Z"),
    });
    await expect(
      postSalesDispatchInventory(tx.client, [
        {
          salesDispatchId: "dispatch-expired",
          salesDispatchNumber: "DN-EXPIRED",
          salesDispatchLineId: "dispatch-line-expired",
          salesDispatchAllocationId: "allocation-expired",
          salesOrderId: "order-1",
          salesOrderLineId: "order-line-1",
          itemId: "item-1",
          warehouseId: "warehouse-1",
          canonicalUnitId: "unit-pcs",
          productionLotId: "lot-1",
          quantity: "80",
          dispatchAt: new Date("2026-01-15T00:00:00.000Z"),
          actorUserId: "actor-1",
        },
      ]),
    ).rejects.toMatchObject({ reason: "reference" });
    expect(tx.createMany).not.toHaveBeenCalled();
  });

  it("blocks invoice quantity beyond the remaining dispatch allocation atomically", async () => {
    const createMany = vi.fn(async () => ({ count: 1 }));
    const tx = {
      inventoryMovement: {
        aggregate: vi.fn(async () => ({ _sum: { quantity: "200" } })),
        createMany,
      },
    } as never;
    await expect(
      postSalesInvoiceOutflowInventory(tx, [
        {
          salesInvoiceId: "invoice-1",
          salesInvoiceNumber: "INV-1",
          salesInvoiceLineId: "invoice-line-1",
          salesInvoiceAllocationId: "invoice-allocation-1",
          salesOrderId: "order-1",
          salesOrderLineId: "order-line-1",
          salesDispatchId: "dispatch-1",
          salesDispatchLineId: "dispatch-line-1",
          salesDispatchAllocationId: "dispatch-allocation-1",
          itemId: "item-1",
          warehouseId: "warehouse-1",
          canonicalUnitId: "unit-pcs",
          productionLotId: "lot-1",
          quantity: "201",
          actorUserId: "actor-1",
        },
      ]),
    ).rejects.toMatchObject({ reason: "stock" });
    expect(createMany).not.toHaveBeenCalled();
  });
});

describe("purchase receipt and QC custody", () => {
  const receipt = {
    itemId: "raw-1",
    warehouseId: "warehouse-1",
    canonicalUnitId: "unit-g",
    quantity: "100",
    inventoryLotId: "inventory-lot-1",
    goodsReceiptId: "receipt-1",
    goodsReceiptNumber: "GRN-1",
    receiptLineId: "receipt-line-1",
    actorUserId: "actor-1",
  };

  it("receives into QUALITY_HOLD and reconciles accepted plus rejected quantity", async () => {
    const tx = receiptTx("100");
    await postPurchaseReceiptInventory(tx.client, [receipt]);
    expect(tx.calls()[0]).toMatchObject([{ status: "QUALITY_HOLD", quantity: "100" }]);

    await postReceiptQcInventory(tx.client, [
      { ...receipt, acceptedQuantity: "60", rejectedQuantity: "40", rejectionReason: "DAMAGED" },
    ]);
    const qcMovements = tx.calls().slice(1).flat();
    expect(qcMovements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "AVAILABLE", quantity: "60" }),
        expect.objectContaining({ status: "QUARANTINE", quantity: "40" }),
      ]),
    );
    expect(total(qcMovements)).toBe("0");
  });

  it("rejects QC classification beyond held quantity without partial movement", async () => {
    const tx = receiptTx("100");
    await expect(
      postReceiptQcInventory(tx.client, [
        { ...receipt, acceptedQuantity: "80", rejectedQuantity: "21" },
      ]),
    ).rejects.toMatchObject({ reason: "stock" });
    expect(tx.createMany).not.toHaveBeenCalled();
  });
});

describe("production material custody", () => {
  it("moves packaging damage from IN_PRODUCTION to DAMAGED", async () => {
    const tx = productionMaterialTx("30");
    await postProductionMaterialInventory(tx.client, packagingDamage("30"));
    const movements = tx.created();
    expect(movements).toMatchObject([
      { status: "IN_PRODUCTION", quantity: "-30" },
      { status: "DAMAGED", quantity: "30" },
    ]);
    expect(total(movements)).toBe("0");
  });

  it("rejects consumption greater than batch-held quantity before writing", async () => {
    const tx = productionMaterialTx("30");
    await expect(
      postProductionMaterialInventory(tx.client, {
        ...packagingDamage("31"),
        operation: "CONSUMPTION",
      }),
    ).rejects.toMatchObject({ reason: "stock" });
    expect(tx.createMany).not.toHaveBeenCalled();
    expect(tx.create).not.toHaveBeenCalled();
  });
});

function finishedGoodsTx({
  available,
  reserved,
  expiryDate = new Date("2026-12-31T00:00:00.000Z"),
}: {
  available: string;
  reserved: string;
  expiryDate?: Date;
}) {
  const createMany = vi.fn(async () => ({ count: 2 }));
  const client = {
    item: {
      findMany: vi.fn(async () => [
        {
          id: "item-1",
          active: true,
          itemType: "FINISHED_GOOD",
          stockUnitId: "unit-pcs",
          stockUnit: { code: "PCS", dimension: "COUNT", active: true },
          finishedGoodProfile: { piecesPerCarton: 24 },
        },
      ]),
    },
    warehouse: { findFirst: vi.fn(async () => ({ id: "warehouse-1", active: true })) },
    productionLot: {
      findMany: vi.fn(async () => [
        {
          id: "lot-1",
          finishedGoodId: "item-1",
          expiryDate,
        },
      ]),
    },
    inventoryMovement: {
      aggregate: vi.fn(async ({ where }: { where: { status: string } }) => ({
        _sum: { quantity: where.status === "RESERVED" ? reserved : available },
      })),
      createMany,
    },
  } as never;
  return {
    client,
    createMany,
    created: () => (createMany.mock.calls[0]?.[0] as { data: Record<string, unknown>[] }).data,
  };
}

function receiptTx(balance: string) {
  const createMany = vi.fn(async () => ({ count: 2 }));
  const client = {
    item: {
      findMany: vi.fn(async () => [
        { id: "raw-1", stockUnit: { code: "G", dimension: "MASS", active: true } },
      ]),
    },
    warehouse: { findMany: vi.fn(async () => [{ id: "warehouse-1" }]) },
    unit: {
      findMany: vi.fn(async () => [{ id: "unit-g", code: "G", dimension: "MASS", active: true }]),
    },
    inventoryLot: {
      findMany: vi.fn(async () => [
        { id: "inventory-lot-1", itemId: "raw-1", sourceGoodsReceiptId: "receipt-1" },
      ]),
    },
    inventoryMovement: {
      aggregate: vi.fn(async () => ({ _sum: { quantity: balance } })),
      createMany,
    },
  } as never;
  return {
    client,
    createMany,
    calls: () =>
      createMany.mock.calls.map((call) => (call[0] as { data: Record<string, unknown>[] }).data),
  };
}

function productionMaterialTx(balance: string) {
  const createMany = vi.fn(async () => ({ count: 2 }));
  const create = vi.fn(async () => ({}));
  const client = {
    item: {
      findFirst: vi.fn(async () => ({
        id: "packaging-1",
        stockUnitId: "unit-pcs",
        stockUnit: { code: "PCS", dimension: "COUNT", active: true },
      })),
    },
    warehouse: { count: vi.fn(async () => 1) },
    unit: {
      findFirst: vi.fn(async () => ({
        id: "unit-pcs",
        code: "PCS",
        dimension: "COUNT",
        active: true,
      })),
    },
    inventoryLot: {
      findUnique: vi.fn(async () => ({ id: "inventory-lot-1", itemId: "packaging-1" })),
    },
    inventoryMovement: {
      aggregate: vi.fn(async () => ({ _sum: { quantity: balance } })),
      createMany,
      create,
    },
  } as never;
  return {
    client,
    createMany,
    create,
    created: () => (createMany.mock.calls[0]?.[0] as { data: Record<string, unknown>[] }).data,
  };
}

function packagingDamage(quantity: string) {
  return {
    materialType: "PACKAGING_MATERIAL" as const,
    operation: "DAMAGE" as const,
    transactionId: "transaction-1",
    transactionNumber: "PMT-1",
    transactionLineId: "transaction-line-1",
    productionBatchId: "batch-1",
    batchNumber: "BATCH-1",
    itemId: "packaging-1",
    custodyWarehouseId: "warehouse-1",
    canonicalUnitId: "unit-pcs",
    quantity,
    inventoryLotId: "inventory-lot-1",
    reason: "Production usage",
    actorUserId: "actor-1",
  };
}

function total(movements: readonly Record<string, unknown>[]) {
  return movements
    .reduce((sum, movement) => sum.add(String(movement.quantity)), new Decimal(0))
    .toFixed();
}
