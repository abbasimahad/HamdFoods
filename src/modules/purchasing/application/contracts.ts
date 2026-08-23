import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import type { ItemType, UnitDimension } from "@/modules/master-data/domain/master-data";

import type { PurchaseOrderStatus } from "../domain/purchasing";

export type SupplierRecord = {
  id: string;
  code: string;
  name: string;
  contactPerson: string;
  phone: string;
  secondaryPhone: string | null;
  email: string;
  address: string;
  city: string;
  taxRegistrationNo: string | null;
  paymentTermsDays: number | null;
  notes: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type SupplierInput = Omit<SupplierRecord, "id" | "active" | "createdAt" | "updatedAt"> & {
  id?: string | undefined;
};

export type PurchaseCatalogItem = {
  id: string;
  code: string;
  name: string;
  itemType: ItemType;
  stockUnitDimension: UnitDimension;
};

export type PurchaseCatalogUnit = {
  id: string;
  code: string;
  name: string;
  symbol: string;
  dimension: UnitDimension;
  active: boolean;
};

export type PurchaseOrderLineInput = {
  itemId: string;
  quantity: string;
  unitId: string;
  unitRate: string;
  discountPercent: string;
  taxPercent: string;
  notes?: string | undefined;
};

export type PurchaseOrderInput = {
  id?: string | undefined;
  supplierId: string;
  orderDate: string;
  expectedDeliveryDate?: string | undefined;
  supplierReference?: string | undefined;
  notes?: string | undefined;
  lines: readonly PurchaseOrderLineInput[];
  actorUserId: string;
};

export type PurchaseOrderLineRecord = {
  id: string;
  position: number;
  itemId: string;
  itemCode: string;
  itemName: string;
  itemType: ItemType;
  orderedQuantity: string;
  orderUnitId: string;
  orderUnitCode: string;
  orderUnitSymbol: string;
  normalizedQuantity: string;
  canonicalUnitCode: string;
  canonicalUnitSymbol: string;
  unitRate: string;
  discountPercent: string;
  taxPercent: string;
  grossAmount: string;
  discountAmount: string;
  taxAmount: string;
  netAmount: string;
  notes: string | null;
};

export type PurchaseOrderRecord = {
  id: string;
  number: string;
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  supplierContactPerson: string;
  supplierPhone: string;
  supplierEmail: string;
  supplierAddress: string;
  supplierCity: string;
  orderDate: Date;
  expectedDeliveryDate: Date | null;
  status: PurchaseOrderStatus;
  supplierReference: string | null;
  notes: string | null;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  grandTotal: string;
  createdByName: string;
  approvedByName: string | null;
  approvedAt: Date | null;
  cancelledByName: string | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  lines: readonly PurchaseOrderLineRecord[];
};

export type PurchaseOrderListRecord = Omit<PurchaseOrderRecord, "lines">;

export type PurchaseOrderQuery = {
  page: number;
  query: string;
  supplierId?: string | undefined;
  status?: PurchaseOrderStatus | undefined;
  dateFrom?: Date | undefined;
  dateTo?: Date | undefined;
};

export type PageResult<T> = {
  records: readonly T[];
  page: number;
  pageCount: number;
  total: number;
};

export interface PurchasingRepository {
  listSuppliers(query: string, page: number): Promise<PageResult<SupplierRecord>>;
  listActiveSuppliers(): Promise<readonly SupplierRecord[]>;
  getSupplier(id: string): Promise<SupplierRecord | null>;
  saveSupplier(input: SupplierInput): Promise<string>;
  setSupplierActive(id: string, active: boolean): Promise<boolean>;
  listCatalogItems(): Promise<readonly PurchaseCatalogItem[]>;
  listCatalogUnits(): Promise<readonly PurchaseCatalogUnit[]>;
  createPurchaseOrder(input: PurchaseOrderInput): Promise<string>;
  updatePurchaseOrder(input: PurchaseOrderInput & { id: string }): Promise<string>;
  approvePurchaseOrder(id: string, actorUserId: string): Promise<void>;
  cancelPurchaseOrder(id: string, reason: string, actorUserId: string): Promise<void>;
  getPurchaseOrder(id: string): Promise<PurchaseOrderRecord | null>;
  listPurchaseOrders(query: PurchaseOrderQuery): Promise<PageResult<PurchaseOrderListRecord>>;
}

export type PurchasingMutationResult =
  { ok: true; id?: string | undefined } | { ok: false; message: string };

export class PurchasingRepositoryError extends Error {
  constructor(
    readonly reason: "not-found" | "conflict" | "invalid-reference" | "invalid-state",
    message: string,
  ) {
    super(message);
    this.name = "PurchasingRepositoryError";
  }
}

export function requirePurchasingManager(actor: ApplicationPrincipal) {
  return actor.active && actor.permissions.includes("purchasing.manage")
    ? null
    : ({ ok: false, message: "Purchasing management permission is required." } as const);
}
