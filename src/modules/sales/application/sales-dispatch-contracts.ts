import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import type { SalesDispatchStatus } from "@/generated/prisma/client";

export type SalesDispatchLotAllocationInput = { productionLotId: string; quantity: string };
export type SalesDispatchLineInput = {
  salesOrderLineId: string;
  cartons: string;
  loosePieces: string;
  notes?: string | undefined;
  allocations: readonly SalesDispatchLotAllocationInput[];
};
export type SalesDispatchInput = {
  salesOrderId: string;
  dispatchDate: string;
  vehicleNumber?: string | undefined;
  driverName?: string | undefined;
  driverPhone?: string | undefined;
  transporter?: string | undefined;
  gatePassReference?: string | undefined;
  notes?: string | undefined;
  lines: readonly SalesDispatchLineInput[];
  actorUserId: string;
};
export type DispatchLotOption = {
  id: string;
  lotNumber: string;
  expiryDate: Date | null;
  availablePieces: string;
};
export type DispatchOrderLine = {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  piecesPerCarton: number;
  orderedPieces: string;
  dispatchedPieces: string;
  remainingPieces: string;
  reservedPieces: string;
  lots: readonly DispatchLotOption[];
};
export type DispatchOrderOption = {
  id: string;
  number: string;
  customerName: string;
  warehouseName: string;
  status: "APPROVED" | "PARTIALLY_DISPATCHED";
};
export type SalesDispatchReferences = { orders: readonly DispatchOrderOption[] };
export type SalesDispatchLineRecord = {
  id: string;
  salesOrderLineId: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  piecesPerCarton: number;
  cartons: string;
  loosePieces: string;
  totalPieces: string;
  notes: string | null;
  orderedPieces: string;
  dispatchedPieces: string;
  refusedPieces: string;
  remainingPieces: string;
  reservedPieces: string;
  invoicedPieces: string;
  invoiceablePieces: string;
  invoices: readonly { id: string; number: string; quantity: string }[];
  allocations: readonly (DispatchLotOption & { quantity: string })[];
};
export type SalesDispatchRecord = {
  id: string;
  number: string;
  salesOrderId: string;
  salesOrderNumber: string;
  customerName: string;
  customerCode: string;
  dispatchAt: Date;
  sourceWarehouseId: string;
  warehouseName: string;
  deliveryAddress: string;
  routeName: string | null;
  salespersonName: string | null;
  vehicleNumber: string | null;
  driverName: string | null;
  driverPhone: string | null;
  transporter: string | null;
  gatePassReference: string | null;
  notes: string | null;
  status: SalesDispatchStatus;
  createdByName: string;
  postedByName: string | null;
  postedAt: Date | null;
  deliveredByName: string | null;
  deliveredAt: Date | null;
  receiverName: string | null;
  deliveryNotes: string | null;
  cancelledByName: string | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  lines: readonly SalesDispatchLineRecord[];
};
export type SalesDispatchQuery = {
  page: number;
  query: string;
  status?: SalesDispatchStatus | undefined;
  customerId?: string | undefined;
  salesOrderId?: string | undefined;
  dateFrom?: Date | undefined;
  dateTo?: Date | undefined;
};
export type SalesDispatchPage<T> = {
  records: readonly T[];
  page: number;
  pageCount: number;
  total: number;
};
export interface SalesDispatchRepository {
  getSalesDispatchReferences(): Promise<SalesDispatchReferences>;
  getDispatchOrder(id: string): Promise<{
    id: string;
    number: string;
    customerName: string;
    warehouseName: string;
    lines: readonly DispatchOrderLine[];
  } | null>;
  createSalesDispatch(input: SalesDispatchInput): Promise<string>;
  updateSalesDispatch(input: SalesDispatchInput & { id: string }): Promise<string>;
  getSalesDispatch(id: string): Promise<SalesDispatchRecord | null>;
  listSalesDispatches(
    query: SalesDispatchQuery,
  ): Promise<SalesDispatchPage<Omit<SalesDispatchRecord, "lines">>>;
  postSalesDispatch(id: string, actorUserId: string): Promise<void>;
  confirmSalesDispatchDelivery(
    id: string,
    receiverName: string | undefined,
    notes: string | undefined,
    actorUserId: string,
  ): Promise<void>;
  cancelSalesDispatch(id: string, reason: string, actorUserId: string): Promise<void>;
}
export type SalesDispatchMutationResult =
  { ok: true; id?: string } | { ok: false; message: string };
export class SalesDispatchRepositoryError extends Error {
  constructor(
    readonly reason: "not-found" | "conflict" | "invalid-reference" | "invalid-state" | "stock",
    message: string,
  ) {
    super(message);
  }
}
export function requireSalesDispatchManager(actor: ApplicationPrincipal) {
  return actor.active && actor.permissions.includes("sales.manage")
    ? null
    : ({ ok: false, message: "Sales management permission is required." } as const);
}
