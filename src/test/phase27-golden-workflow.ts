import { PrismaInventoryValuationRepository } from "@/server/costing/prisma-inventory-valuation-repository";
import { PrismaInventoryRepository } from "@/server/inventory/prisma-inventory-repository";
import { PrismaGoodsReceiptRepository } from "@/server/purchasing/prisma-goods-receipt-repository";
import { PrismaPurchasingRepository } from "@/server/purchasing/prisma-purchasing-repository";
import { PrismaProductionBatchRepository } from "@/server/production/prisma-production-batch-repository";
import { PrismaProductionMaterialRepository } from "@/server/production/prisma-production-material-repository";
import { PrismaProductionOutputRepository } from "@/server/production/prisma-production-output-repository";
import { PrismaProductionPackagingRepository } from "@/server/production/prisma-production-packaging-repository";
import { PrismaRecipeRepository } from "@/server/production/prisma-recipe-repository";
import { PrismaCustomerPaymentRepository } from "@/server/sales/prisma-customer-payment-repository";
import { PrismaSalesDispatchRepository } from "@/server/sales/prisma-sales-dispatch-repository";
import { PrismaSalesInvoiceRepository } from "@/server/sales/prisma-sales-invoice-repository";
import { PrismaSalesOrderRepository } from "@/server/sales/prisma-sales-order-repository";
import { PrismaSalesReturnRepository } from "@/server/sales/prisma-sales-return-repository";
import {
  postSupplierPayment,
  reverseSupplierPayment,
  saveSupplierPayment,
} from "@/server/accounting/prisma-phase23-repository";
import { prisma } from "@/server/db/prisma";
import { PHASE27_ADMIN } from "./test-environment";

export type Phase27WorkflowState = Awaited<ReturnType<typeof executePhase27GoldenWorkflow>>;

export async function executePhase27GoldenWorkflow() {
  const actor = await prisma.user.findUniqueOrThrow({ where: { email: PHASE27_ADMIN.email } });
  const [
    grams,
    pieces,
    raw,
    packaging,
    finished,
    sourceWarehouse,
    destinationWarehouse,
    supplier,
    customer,
    area,
    route,
    salesperson,
    bank,
  ] = await Promise.all([
    prisma.unit.findUniqueOrThrow({ where: { code: "G" } }),
    prisma.unit.findUniqueOrThrow({ where: { code: "PCS" } }),
    prisma.item.findUniqueOrThrow({ where: { code: "P27-RAW" } }),
    prisma.item.findUniqueOrThrow({ where: { code: "P27-PACK" } }),
    prisma.item.findUniqueOrThrow({ where: { code: "P27-FG" } }),
    prisma.warehouse.findUniqueOrThrow({ where: { code: "P27-SOURCE" } }),
    prisma.warehouse.findUniqueOrThrow({ where: { code: "P27-DEST" } }),
    prisma.supplier.findUniqueOrThrow({ where: { code: "P27-SUP" } }),
    prisma.customer.findUniqueOrThrow({ where: { code: "P27-CUST" } }),
    prisma.salesArea.findUniqueOrThrow({ where: { code: "P27-AREA" } }),
    prisma.salesRoute.findUniqueOrThrow({ where: { code: "P27-ROUTE" } }),
    prisma.salesperson.findUniqueOrThrow({ where: { code: "P27-SALES" } }),
    prisma.treasuryAccount.findUniqueOrThrow({ where: { code: "P27-BANK" } }),
  ]);

  const purchasing = new PrismaPurchasingRepository();
  const receiving = new PrismaGoodsReceiptRepository();
  const inventory = new PrismaInventoryRepository();
  const recipeRepository = new PrismaRecipeRepository();
  const batches = new PrismaProductionBatchRepository();
  const materials = new PrismaProductionMaterialRepository();
  const packagingTransactions = new PrismaProductionPackagingRepository();
  const outputs = new PrismaProductionOutputRepository();
  const costing = new PrismaInventoryValuationRepository();
  const orders = new PrismaSalesOrderRepository();
  const dispatches = new PrismaSalesDispatchRepository();
  const invoices = new PrismaSalesInvoiceRepository();
  const payments = new PrismaCustomerPaymentRepository();
  const returns = new PrismaSalesReturnRepository();

  const movementsBeforeApproval = await prisma.inventoryMovement.count();
  const purchaseOrderId = await purchasing.createPurchaseOrder({
    supplierId: supplier.id,
    orderDate: "2026-06-01",
    expectedDeliveryDate: "2026-06-05",
    supplierReference: "P27-PO-REFERENCE",
    notes: "Phase 27 deterministic purchase workflow.",
    actorUserId: actor.id,
    lines: [
      {
        itemId: raw.id,
        quantity: "10000",
        unitId: grams.id,
        unitRate: "1",
        discountPercent: "0",
        taxPercent: "0",
      },
      {
        itemId: packaging.id,
        quantity: "100",
        unitId: pieces.id,
        unitRate: "10",
        discountPercent: "0",
        taxPercent: "0",
      },
    ],
  });
  await purchasing.approvePurchaseOrder(purchaseOrderId, actor.id);
  const movementsAfterApproval = await prisma.inventoryMovement.count();
  const purchaseOrder = await purchasing.getPurchaseOrder(purchaseOrderId);
  if (!purchaseOrder) throw new Error("Phase 27 purchase order was not created.");
  const rawOrderLine = purchaseOrder.lines.find((line) => line.itemId === raw.id);
  const packagingOrderLine = purchaseOrder.lines.find((line) => line.itemId === packaging.id);
  if (!rawOrderLine || !packagingOrderLine)
    throw new Error("Phase 27 purchase order lines are incomplete.");

  const goodsReceiptId = await receiving.createGoodsReceipt({
    purchaseOrderId,
    receiptDate: "2026-06-02",
    warehouseId: sourceWarehouse.id,
    supplierDeliveryNumber: "P27-DELIVERY",
    notes: "Phase 27 deterministic receipt.",
    actorUserId: actor.id,
    lines: [
      {
        purchaseOrderLineId: rawOrderLine.id,
        quantity: "10000",
        unitId: grams.id,
        supplierLotNumber: "P27-RAW-LOT",
        manufacturingDate: "2026-05-15",
        expiryDate: "2027-05-15",
      },
      {
        purchaseOrderLineId: packagingOrderLine.id,
        quantity: "100",
        unitId: pieces.id,
        supplierLotNumber: "P27-PACK-LOT",
        manufacturingDate: "2026-05-15",
        expiryDate: "2028-05-15",
      },
    ],
  });
  await receiving.postGoodsReceipt(goodsReceiptId, actor.id);
  const receipt = await receiving.getGoodsReceipt(goodsReceiptId);
  if (!receipt) throw new Error("Phase 27 goods receipt was not created.");
  const rawReceiptLine = receipt.lines.find((line) => line.itemId === raw.id);
  const packagingReceiptLine = receipt.lines.find((line) => line.itemId === packaging.id);
  if (!rawReceiptLine?.inventoryLotId || !packagingReceiptLine?.inventoryLotId)
    throw new Error("Phase 27 receipt lots are incomplete.");
  await receiving.completeGoodsReceiptQc(
    goodsReceiptId,
    [
      {
        goodsReceiptLineId: rawReceiptLine.id,
        acceptedQuantity: "9000",
        rejectedQuantity: "1000",
        rejectionReason: "QUALITY_FAILURE",
        rejectionNotes: "Deterministic rejected quantity.",
      },
      {
        goodsReceiptLineId: packagingReceiptLine.id,
        acceptedQuantity: "100",
        rejectedQuantity: "0",
      },
    ],
    actor.id,
  );

  const valuationBeforeTransfer = await prisma.inventoryValuationBalance.findUniqueOrThrow({
    where: { itemId: raw.id },
  });
  const transferGroupId = await inventory.transferWarehouse({
    itemId: raw.id,
    sourceWarehouseId: sourceWarehouse.id,
    destinationWarehouseId: destinationWarehouse.id,
    status: "AVAILABLE",
    referenceId: "P27-WAREHOUSE-TRANSFER",
    sourceKey: "P27-WAREHOUSE-TRANSFER",
    quantity: "1000",
    unitId: grams.id,
    reason: "Phase 27 warehouse reconciliation.",
    actorUserId: actor.id,
  });
  const valuationAfterTransfer = await prisma.inventoryValuationBalance.findUniqueOrThrow({
    where: { itemId: raw.id },
  });

  const recipeId = await recipeRepository.createRecipe({
    code: "P27-RECIPE",
    name: "Phase 27 Sauce Recipe",
    finishedGoodId: finished.id,
    standardBatchQuantity: "1000",
    standardBatchUnitId: grams.id,
    expectedOutputQuantity: "1000",
    expectedOutputUnitId: grams.id,
    effectiveDate: "2026-06-01",
    notes: "Phase 27 deterministic recipe.",
    actorUserId: actor.id,
    ingredients: [
      {
        itemId: raw.id,
        quantity: "1000",
        unitId: grams.id,
        allowancePercent: "0",
      },
    ],
    packagingLines: [
      {
        itemId: packaging.id,
        usageBasis: "PER_PIECE",
        quantity: "1",
        unitId: pieces.id,
        allowancePercent: "0",
      },
    ],
  });
  await recipeRepository.approveRecipe(recipeId, actor.id);
  const batchId = await batches.createBatch({
    recipeId,
    plannedBatchQuantity: "1000",
    plannedBatchUnitId: grams.id,
    plannedProductionDate: "2026-06-03",
    targetCompletionDate: "2026-06-04",
    rawMaterialWarehouseId: sourceWarehouse.id,
    packagingWarehouseId: sourceWarehouse.id,
    finishedGoodsDestinationWarehouseId: sourceWarehouse.id,
    plannedCartons: "0",
    plannedLoosePieces: "2",
    notes: "Phase 27 deterministic batch.",
    actorUserId: actor.id,
  });
  await batches.planBatch(batchId, actor.id);
  await batches.releaseBatch(batchId, actor.id, false);
  const batch = await batches.getBatch(batchId);
  const materialRequirement = batch?.materialRequirements[0];
  const packagingRequirement = batch?.packagingRequirements[0];
  if (!materialRequirement || !packagingRequirement)
    throw new Error("Phase 27 batch requirements are incomplete.");

  const issueId = await materials.createTransaction({
    productionBatchId: batchId,
    transactionType: "ISSUE",
    transactionDate: "2026-06-03",
    batchRequirementId: materialRequirement.id,
    inventoryLotId: rawReceiptLine.inventoryLotId,
    quantity: "1000",
    unitId: grams.id,
    destinationWarehouseId: sourceWarehouse.id,
    actorUserId: actor.id,
  });
  await materials.postTransaction(issueId, actor.id);
  const consumptionId = await materials.createTransaction({
    productionBatchId: batchId,
    transactionType: "CONSUMPTION",
    transactionDate: "2026-06-03",
    batchRequirementId: materialRequirement.id,
    inventoryLotId: rawReceiptLine.inventoryLotId,
    quantity: "1000",
    unitId: grams.id,
    actorUserId: actor.id,
  });
  await materials.postTransaction(consumptionId, actor.id);
  const packagingIssueId = await packagingTransactions.createTransaction({
    productionBatchId: batchId,
    transactionType: "ISSUE",
    transactionDate: "2026-06-03",
    packagingRequirementId: packagingRequirement.id,
    inventoryLotId: packagingReceiptLine.inventoryLotId,
    quantity: "2",
    unitId: pieces.id,
    destinationWarehouseId: sourceWarehouse.id,
    actorUserId: actor.id,
  });
  await packagingTransactions.postTransaction(packagingIssueId, actor.id);
  const packagingConsumptionId = await packagingTransactions.createTransaction({
    productionBatchId: batchId,
    transactionType: "CONSUMPTION",
    transactionDate: "2026-06-03",
    packagingRequirementId: packagingRequirement.id,
    inventoryLotId: packagingReceiptLine.inventoryLotId,
    quantity: "2",
    unitId: pieces.id,
    actorUserId: actor.id,
  });
  await packagingTransactions.postTransaction(packagingConsumptionId, actor.id);
  const outputId = await outputs.createTransaction({
    productionBatchId: batchId,
    outputType: "GOOD",
    transactionDate: "2026-06-04",
    cartons: "0",
    loosePieces: "2",
    productionDate: "2026-06-04",
    expiryDate: "2027-06-04",
    destinationWarehouseId: sourceWarehouse.id,
    actorUserId: actor.id,
  });
  await outputs.postTransaction(outputId, actor.id);
  await outputs.completeBatch(batchId, actor.id);
  await costing.finalizeBatchCost(batchId, actor.id);
  const productionLot = await prisma.productionLot.findUniqueOrThrow({
    where: { productionBatchId: batchId },
  });

  const salesOrderId = await orders.createSalesOrder({
    customerId: customer.id,
    salespersonId: salesperson.id,
    areaId: area.id,
    routeId: route.id,
    warehouseId: sourceWarehouse.id,
    orderDate: "2026-06-05",
    deliveryDate: "2026-06-06",
    customerReference: "P27-CUSTOMER-ORDER",
    notes: "Phase 27 deterministic sale.",
    actorUserId: actor.id,
    lines: [
      {
        itemId: finished.id,
        cartons: "0",
        loosePieces: "1",
        cartonRate: "2400",
        discount1Percent: "0",
        discount2Percent: "0",
        taxPercent: "18",
      },
    ],
  });
  await orders.approveSalesOrder(salesOrderId, actor.id);
  const salesOrder = await orders.getSalesOrder(salesOrderId);
  const salesOrderLine = salesOrder?.lines[0];
  if (!salesOrderLine) throw new Error("Phase 27 sales order line is missing.");
  const dispatchId = await dispatches.createSalesDispatch({
    salesOrderId,
    dispatchDate: "2026-06-06",
    vehicleNumber: "P27-VEHICLE",
    driverName: "Phase 27 Driver",
    notes: "Phase 27 deterministic dispatch.",
    actorUserId: actor.id,
    lines: [
      {
        salesOrderLineId: salesOrderLine.id,
        cartons: "0",
        loosePieces: "1",
        allocations: [{ productionLotId: productionLot.id, quantity: "1" }],
      },
    ],
  });
  await dispatches.postSalesDispatch(dispatchId, actor.id);
  const dispatch = await dispatches.getSalesDispatch(dispatchId);
  const dispatchLine = dispatch?.lines[0];
  const dispatchAllocation = dispatchLine?.allocations[0];
  if (!dispatchLine || !dispatchAllocation)
    throw new Error("Phase 27 dispatch allocation is missing.");
  const invoiceId = await invoices.createSalesInvoice({
    salesOrderId,
    invoiceDate: "2026-06-07",
    notes: "Phase 27 deterministic invoice.",
    actorUserId: actor.id,
    lines: [{ salesDispatchLineId: dispatchLine.id, cartons: "0", loosePieces: "1" }],
  });
  await invoices.postSalesInvoice(invoiceId, actor.id);

  const customerPaymentId = await payments.createCustomerPayment({
    customerId: customer.id,
    paymentDate: "2026-06-08",
    method: "BANK_TRANSFER",
    totalAmount: "50",
    referenceNumber: "P27-CUSTOMER-PAYMENT",
    notes: "Phase 27 deterministic payment.",
    allocations: [{ salesInvoiceId: invoiceId, allocatedAmount: "50" }],
    actorUserId: actor.id,
  });
  await payments.postCustomerPayment(customerPaymentId, actor.id);
  const customerPaymentReversalId = await payments.reverseCustomerPayment(
    customerPaymentId,
    actor.id,
    new Date("2026-06-09T00:00:00.000Z"),
    "Phase 27 customer payment reversal regression.",
  );

  const returnSource = await returns.getInvoicedReturnSource(invoiceId, dispatchId);
  const returnSourceLine = returnSource?.lines[0];
  if (!returnSourceLine?.salesInvoiceLineId)
    throw new Error("Phase 27 invoiced return source is missing.");
  const salesReturnId = await returns.createSalesReturn({
    type: "INVOICED_RETURN",
    salesInvoiceId: invoiceId,
    salesDispatchId: dispatchId,
    receivingWarehouseId: sourceWarehouse.id,
    returnDate: "2026-06-10",
    customerReference: "P27-RETURN",
    notes: "Phase 27 deterministic sales return.",
    actorUserId: actor.id,
    lines: [
      {
        salesInvoiceLineId: returnSourceLine.salesInvoiceLineId,
        salesDispatchLineId: returnSourceLine.salesDispatchLineId,
        salesDispatchAllocationId: returnSourceLine.salesDispatchAllocationId,
        cartons: "0",
        loosePieces: "1",
        reason: "CUSTOMER_REJECTION",
      },
    ],
  });
  await returns.receiveSalesReturn(salesReturnId, actor.id);
  const receivedReturn = await returns.getSalesReturn(salesReturnId);
  const salesReturnLine = receivedReturn?.lines[0];
  if (!salesReturnLine) throw new Error("Phase 27 sales return line is missing.");
  await returns.inspectSalesReturn(
    salesReturnId,
    [
      {
        salesReturnLineId: salesReturnLine.id,
        classification: "GOOD_RESALE",
        quantity: "1",
        notes: "Returned stock passed resale inspection.",
      },
    ],
    actor.id,
  );
  await returns.completeSalesReturn(salesReturnId, actor.id);

  const payable = await prisma.supplierPayableLedgerEntry.findFirstOrThrow({
    where: { supplierId: supplier.id, sourceType: "GOODS_RECEIPT", sourceId: goodsReceiptId },
  });
  const supplierPaymentId = await saveSupplierPayment(actor.id, {
    supplierId: supplier.id,
    paymentDate: new Date("2026-06-11T00:00:00.000Z"),
    treasuryAccountId: bank.id,
    method: "BANK_TRANSFER",
    totalAmount: "2000",
    bankReference: "P27-SUPPLIER-PAYMENT",
    notes: "Phase 27 deterministic supplier payment.",
    allocations: [{ payableLedgerEntryId: payable.id, allocatedAmount: "2000" }],
  });
  await postSupplierPayment(supplierPaymentId, actor.id);
  const supplierPaymentReversalId = await reverseSupplierPayment(
    supplierPaymentId,
    actor.id,
    new Date("2026-06-12T00:00:00.000Z"),
    "Phase 27 supplier payment reversal regression.",
  );

  return {
    actorUserId: actor.id,
    rawItemId: raw.id,
    packagingItemId: packaging.id,
    finishedItemId: finished.id,
    sourceWarehouseId: sourceWarehouse.id,
    destinationWarehouseId: destinationWarehouse.id,
    customerId: customer.id,
    supplierId: supplier.id,
    purchaseOrderId,
    goodsReceiptId,
    recipeId,
    batchId,
    productionLotId: productionLot.id,
    salesOrderId,
    dispatchId,
    invoiceId,
    customerPaymentId,
    customerPaymentReversalId,
    salesReturnId,
    supplierPaymentId,
    supplierPaymentReversalId,
    transferGroupId,
    rawInventoryLotId: rawReceiptLine.inventoryLotId,
    customerPaymentAllocationId: (
      await prisma.customerPaymentAllocation.findFirstOrThrow({
        where: { customerPaymentId },
      })
    ).id,
    movementsBeforeApproval,
    movementsAfterApproval,
    valuationBeforeTransfer: valuationBeforeTransfer.inventoryValue.toString(),
    valuationAfterTransfer: valuationAfterTransfer.inventoryValue.toString(),
  };
}
