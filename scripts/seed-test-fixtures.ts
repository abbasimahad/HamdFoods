import { bootstrapSuperAdmin } from "../src/modules/access/application/bootstrap-super-admin";
import { seedAccessControl } from "../src/modules/access/application/seed-access-control";
import { seedMasterData } from "../src/modules/master-data/application/seed-master-data";
import { PrismaAccessRepository } from "../src/server/access/prisma-access-repository";
import { PrismaMasterDataRepository } from "../src/server/master-data/prisma-master-data-repository";
import { prisma } from "../src/server/db/prisma";
import { PHASE27_ADMIN, PHASE27_VIEWER } from "../src/test/test-environment";

const access = new PrismaAccessRepository();
await seedAccessControl(access);
await seedMasterData(new PrismaMasterDataRepository());

const admin = await bootstrapSuperAdmin(PHASE27_ADMIN, access);
let viewer = await access.findUserByEmail(PHASE27_VIEWER.email);
if (!viewer)
  viewer = await access.createCredentialUser({
    name: PHASE27_VIEWER.name,
    email: PHASE27_VIEWER.email,
    password: PHASE27_VIEWER.password,
  });
await access.setUserActive(viewer.id, true);
await access.ensureUserRole(viewer.id, "VIEWER");

const [grams, pieces, ingredientCategory, bottleCategory, finishedCategory] = await Promise.all([
  prisma.unit.findUniqueOrThrow({ where: { code: "G" } }),
  prisma.unit.findUniqueOrThrow({ where: { code: "PCS" } }),
  prisma.itemCategory.findUniqueOrThrow({ where: { code: "INGREDIENTS" } }),
  prisma.itemCategory.findUniqueOrThrow({ where: { code: "BOTTLES" } }),
  prisma.itemCategory.findUniqueOrThrow({ where: { code: "SAUCES" } }),
]);

const raw = await prisma.item.upsert({
  where: { code: "P27-RAW" },
  create: {
    code: "P27-RAW",
    name: "Phase 27 Raw Ingredient",
    itemType: "RAW_MATERIAL",
    categoryId: ingredientCategory.id,
    stockUnitId: grams.id,
  },
  update: { name: "Phase 27 Raw Ingredient", active: true },
});
const packaging = await prisma.item.upsert({
  where: { code: "P27-PACK" },
  create: {
    code: "P27-PACK",
    name: "Phase 27 Bottle",
    itemType: "PACKAGING_MATERIAL",
    categoryId: bottleCategory.id,
    stockUnitId: pieces.id,
    packagingKind: "BOTTLE",
  },
  update: { name: "Phase 27 Bottle", active: true },
});
const finished = await prisma.item.upsert({
  where: { code: "P27-FG" },
  create: {
    code: "P27-FG",
    name: "Phase 27 Finished Sauce",
    itemType: "FINISHED_GOOD",
    categoryId: finishedCategory.id,
    stockUnitId: pieces.id,
  },
  update: { name: "Phase 27 Finished Sauce", active: true },
});
await prisma.finishedGoodProfile.upsert({
  where: { itemId: finished.id },
  create: {
    itemId: finished.id,
    netContentQuantity: "500",
    netContentUnitId: grams.id,
    netContentUnitDimension: "MASS",
    piecesPerCarton: 24,
  },
  update: { netContentQuantity: "500", netContentUnitId: grams.id, piecesPerCarton: 24 },
});

const sourceWarehouse = await prisma.warehouse.upsert({
  where: { code: "P27-SOURCE" },
  create: { code: "P27-SOURCE", name: "Phase 27 Source Warehouse" },
  update: { name: "Phase 27 Source Warehouse", active: true },
});
const destinationWarehouse = await prisma.warehouse.upsert({
  where: { code: "P27-DEST" },
  create: { code: "P27-DEST", name: "Phase 27 Destination Warehouse" },
  update: { name: "Phase 27 Destination Warehouse", active: true },
});
const supplier = await prisma.supplier.upsert({
  where: { code: "P27-SUP" },
  create: {
    code: "P27-SUP",
    name: "Phase 27 Supplier",
    contactPerson: "Test Supplier Contact",
    phone: "+92-300-0000027",
    email: "supplier@example.test",
    address: "Test-only supplier address",
    city: "Karachi",
    paymentTermsDays: 30,
  },
  update: { name: "Phase 27 Supplier", active: true },
});

const group = await prisma.customerGroup.upsert({
  where: { code: "P27-GROUP" },
  create: { code: "P27-GROUP", name: "Phase 27 Customers" },
  update: { name: "Phase 27 Customers", active: true },
});
const area = await prisma.salesArea.upsert({
  where: { code: "P27-AREA" },
  create: { code: "P27-AREA", name: "Phase 27 Area" },
  update: { name: "Phase 27 Area", active: true },
});
const route = await prisma.salesRoute.upsert({
  where: { code: "P27-ROUTE" },
  create: { code: "P27-ROUTE", name: "Phase 27 Route", areaId: area.id },
  update: { name: "Phase 27 Route", areaId: area.id, active: true },
});
const salesperson = await prisma.salesperson.upsert({
  where: { code: "P27-SALES" },
  create: { code: "P27-SALES", name: "Phase 27 Salesperson" },
  update: { name: "Phase 27 Salesperson", active: true },
});
const customer = await prisma.customer.upsert({
  where: { code: "P27-CUST" },
  create: {
    code: "P27-CUST",
    name: "Phase 27 Customer",
    phone: "+92-300-0001027",
    address: "Test-only customer address",
    city: "Karachi",
    customerGroupId: group.id,
    areaId: area.id,
    routeId: route.id,
    salespersonId: salesperson.id,
    creditLimit: "1000000",
    paymentTermsDays: 30,
  },
  update: { name: "Phase 27 Customer", active: true },
});

const mappingKeys = [
  "ACCOUNTS_RECEIVABLE",
  "ACCOUNTS_PAYABLE",
  "RAW_MATERIAL_INVENTORY",
  "PACKAGING_INVENTORY",
  "FINISHED_GOODS_INVENTORY",
  "WORK_IN_PROCESS",
  "SALES_REVENUE",
  "SALES_DISCOUNTS",
  "SALES_RETURNS",
  "OUTPUT_TAX",
  "INPUT_TAX",
  "COST_OF_GOODS_SOLD",
  "GRNI",
  "SUPPLIER_CLAIMS",
  "LANDED_COST_CLEARING",
  "PRODUCTION_COST_CLEARING",
  "INVENTORY_VARIANCE",
  "PURCHASE_RETURN_VARIANCE",
  "PURCHASE_TAX_EXPENSE",
  "OPENING_BALANCE_EQUITY",
  "DEFAULT_CASH",
  "DEFAULT_BANK",
  "SALES_RETURN_INVENTORY_CLEARING",
] as const;
await prisma.accountingSettings.upsert({
  where: { id: "default" },
  create: { id: "default", baseCurrencyCode: "PKR", purchaseTaxTreatment: "RECOVERABLE" },
  update: { baseCurrencyCode: "PKR", purchaseTaxTreatment: "RECOVERABLE" },
});
for (const [index, mappingKey] of mappingKeys.entries()) {
  const accountType = accountTypeFor(mappingKey);
  const account = await prisma.accountingAccount.upsert({
    where: { code: `P27-${String(index + 1).padStart(3, "0")}` },
    create: {
      code: `P27-${String(index + 1).padStart(3, "0")}`,
      name: `Phase 27 ${mappingKey.replaceAll("_", " ")}`,
      accountType,
      isControl: isControlMapping(mappingKey),
    },
    update: { active: true, postingAllowed: true },
  });
  await prisma.accountingAccountMapping.upsert({
    where: { accountingSettingsId_mappingKey: { accountingSettingsId: "default", mappingKey } },
    create: { accountingSettingsId: "default", mappingKey, accountId: account.id },
    update: { accountId: account.id },
  });
}
await prisma.accountingPeriod.upsert({
  where: { name: "Phase 27 Test Period" },
  create: {
    name: "Phase 27 Test Period",
    startDate: new Date("2026-01-01T00:00:00.000Z"),
    endDate: new Date("2026-12-31T00:00:00.000Z"),
    status: "OPEN",
  },
  update: { status: "OPEN" },
});
const cashGl = await prisma.accountingAccount.findUniqueOrThrow({ where: { code: "P27-021" } });
const bankGl = await prisma.accountingAccount.findUniqueOrThrow({ where: { code: "P27-022" } });
await prisma.treasuryAccount.upsert({
  where: { code: "P27-CASH" },
  create: { code: "P27-CASH", name: "Phase 27 Cash", accountType: "CASH", glAccountId: cashGl.id },
  update: { active: true, glAccountId: cashGl.id },
});
await prisma.treasuryAccount.upsert({
  where: { code: "P27-BANK" },
  create: { code: "P27-BANK", name: "Phase 27 Bank", accountType: "BANK", glAccountId: bankGl.id },
  update: { active: true, glAccountId: bankGl.id },
});

console.log(
  `Phase 27 fixtures ready: users ${admin.userId}/${viewer.id}, items ${raw.id}/${packaging.id}/${finished.id}, warehouses ${sourceWarehouse.id}/${destinationWarehouse.id}, supplier ${supplier.id}, customer ${customer.id}.`,
);
await prisma.$disconnect();

function accountTypeFor(mappingKey: (typeof mappingKeys)[number]) {
  if (["ACCOUNTS_PAYABLE", "OUTPUT_TAX", "GRNI"].includes(mappingKey)) return "LIABILITY" as const;
  if (["SALES_REVENUE", "SALES_RETURNS"].includes(mappingKey)) return "REVENUE" as const;
  if (mappingKey === "OPENING_BALANCE_EQUITY") return "EQUITY" as const;
  if (
    [
      "SALES_DISCOUNTS",
      "COST_OF_GOODS_SOLD",
      "INVENTORY_VARIANCE",
      "PURCHASE_RETURN_VARIANCE",
      "PURCHASE_TAX_EXPENSE",
    ].includes(mappingKey)
  )
    return "EXPENSE" as const;
  return "ASSET" as const;
}

function isControlMapping(mappingKey: (typeof mappingKeys)[number]) {
  return [
    "ACCOUNTS_RECEIVABLE",
    "ACCOUNTS_PAYABLE",
    "RAW_MATERIAL_INVENTORY",
    "PACKAGING_INVENTORY",
    "FINISHED_GOODS_INVENTORY",
    "WORK_IN_PROCESS",
  ].includes(mappingKey);
}
