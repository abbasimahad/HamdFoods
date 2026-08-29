import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import type { SalesOrderStatus } from "../domain/sales-orders";

export type SalesOrderLineInput = {
  itemId: string;
  cartons: string;
  loosePieces: string;
  cartonRate: string;
  discount1Percent: string;
  discount2Percent: string;
  taxPercent: string;
  notes?: string | undefined;
};
export type SalesOrderInput = {
  customerId: string;
  salespersonId?: string | undefined;
  areaId?: string | undefined;
  routeId?: string | undefined;
  warehouseId: string;
  orderDate: string;
  deliveryDate?: string | undefined;
  customerReference?: string | undefined;
  notes?: string | undefined;
  lines: readonly SalesOrderLineInput[];
  actorUserId: string;
};
export type SalesOrderCatalogItem = {
  id: string;
  code: string;
  name: string;
  piecesPerCarton: number;
  availablePieces: string;
};
export type SalesOrderCustomerOption = {
  id: string;
  code: string;
  name: string;
  salespersonId: string | null;
  salespersonName: string | null;
  areaId: string;
  areaName: string;
  routeId: string | null;
  routeName: string | null;
  paymentTermsDays: number | null;
  creditLimit: string | null;
};
export type SalesOrderReferences = {
  customers: readonly SalesOrderCustomerOption[];
  warehouses: readonly { id: string; code: string; name: string }[];
  items: readonly Omit<SalesOrderCatalogItem, "availablePieces">[];
};
export type SalesOrderLineRecord = SalesOrderLineInput & {
  id: string;
  position: number;
  itemCode: string;
  itemName: string;
  piecesPerCarton: number;
  totalPieces: string;
  pieceRate: string;
  grossAmount: string;
  discountAmount: string;
  taxAmount: string;
  netAmount: string;
  availablePieces: string;
  reservedPieces: string;
  dispatchedPieces: string;
  refusedPieces: string;
  remainingDeliveryPieces: string;
  redeliveryReservationPieces: string;
};
export type SalesOrderRecord = {
  id: string;
  number: string;
  orderDate: Date;
  deliveryDate: Date | null;
  customerId: string;
  customerCode: string;
  customerName: string;
  salespersonId: string | null;
  salespersonName: string | null;
  areaId: string;
  areaName: string;
  routeId: string | null;
  routeName: string | null;
  warehouseId: string;
  warehouseName: string;
  status: SalesOrderStatus;
  customerReference: string | null;
  notes: string | null;
  paymentTermsDays: number | null;
  customerCreditLimit: string | null;
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
  lines: readonly SalesOrderLineRecord[];
};
export type SalesOrderQuery = {
  page: number;
  query: string;
  customerId?: string | undefined;
  salespersonId?: string | undefined;
  status?: SalesOrderStatus | undefined;
  dateFrom?: Date | undefined;
  dateTo?: Date | undefined;
};
export type SalesOrderPage<T> = {
  records: readonly T[];
  page: number;
  pageCount: number;
  total: number;
};
export interface SalesOrderRepository {
  getSalesOrderReferences(): Promise<SalesOrderReferences>;
  listSalesOrderItems(warehouseId: string): Promise<readonly SalesOrderCatalogItem[]>;
  createSalesOrder(input: SalesOrderInput): Promise<string>;
  updateSalesOrder(input: SalesOrderInput & { id: string }): Promise<string>;
  approveSalesOrder(id: string, actorUserId: string): Promise<void>;
  reserveRedeliveryStock(id: string, actorUserId: string): Promise<void>;
  cancelSalesOrder(id: string, reason: string, actorUserId: string): Promise<void>;
  getSalesOrder(id: string): Promise<SalesOrderRecord | null>;
  listSalesOrders(query: SalesOrderQuery): Promise<SalesOrderPage<Omit<SalesOrderRecord, "lines">>>;
}
export type SalesOrderMutationResult = { ok: true; id?: string } | { ok: false; message: string };
export class SalesOrderRepositoryError extends Error {
  constructor(
    readonly reason: "not-found" | "conflict" | "invalid-reference" | "invalid-state" | "stock",
    message: string,
  ) {
    super(message);
  }
}
export function requireSalesOrderManager(actor: ApplicationPrincipal) {
  return actor.active && actor.permissions.includes("sales.manage")
    ? null
    : ({ ok: false, message: "Sales management permission is required." } as const);
}
