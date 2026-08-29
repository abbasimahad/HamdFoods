import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import type {
  SalesReturnInspectionClassification,
  SalesReturnReason,
  SalesReturnStatus,
  SalesReturnType,
} from "@/generated/prisma/client";

export type SalesReturnLineInput = {
  salesInvoiceLineId?: string | undefined;
  salesDispatchLineId: string;
  salesDispatchAllocationId: string;
  cartons: string;
  loosePieces: string;
  reason: SalesReturnReason;
  notes?: string | undefined;
};
export type SalesReturnInput = {
  type: SalesReturnType;
  salesInvoiceId?: string | undefined;
  salesDispatchId: string;
  receivingWarehouseId: string;
  returnDate: string;
  customerReference?: string | undefined;
  notes?: string | undefined;
  lines: readonly SalesReturnLineInput[];
  actorUserId: string;
};
export type ReturnInspectionInput = {
  salesReturnLineId: string;
  classification: SalesReturnInspectionClassification;
  quantity: string;
  reason?: string | undefined;
  notes?: string | undefined;
};
export type SalesReturnSourceLine = {
  salesInvoiceLineId: string | null;
  salesDispatchLineId: string;
  salesDispatchAllocationId: string;
  itemCode: string;
  itemName: string;
  lotNumber: string;
  expiryDate: Date | null;
  piecesPerCarton: number;
  dispatchedPieces: string;
  invoicedPieces: string;
  returnedPieces: string;
  returnablePieces: string;
  cartons: string;
  loosePieces: string;
};
export type SalesReturnSource = {
  type: SalesReturnType;
  sourceId: string;
  sourceNumber: string;
  customerId: string;
  customerName: string;
  salesOrderId: string;
  salesOrderNumber: string;
  salesDispatchId: string;
  warehouseId: string;
  warehouseName: string;
  lines: readonly SalesReturnSourceLine[];
};
export type SalesReturnReferences = {
  invoices: readonly {
    id: string;
    number: string;
    customerName: string;
    dispatches: readonly { id: string; number: string }[];
  }[];
  dispatches: readonly { id: string; number: string; customerName: string }[];
  warehouses: readonly { id: string; code: string; name: string }[];
  customers: readonly { id: string; code: string; name: string }[];
};
export type SalesReturnInspectionRecord = {
  id: string;
  classification: SalesReturnInspectionClassification;
  quantity: string;
  reason: string | null;
  notes: string | null;
  createdByName: string;
};
export type SalesReturnLineRecord = {
  id: string;
  salesInvoiceLineId: string | null;
  salesDispatchLineId: string;
  salesDispatchAllocationId: string;
  itemCode: string;
  itemName: string;
  lotNumber: string;
  expiryDate: Date | null;
  piecesPerCarton: number;
  cartons: string;
  loosePieces: string;
  totalPieces: string;
  reason: SalesReturnReason;
  notes: string | null;
  grossAmount: string | null;
  discountAmount: string | null;
  taxAmount: string | null;
  netAmount: string | null;
  inspections: readonly SalesReturnInspectionRecord[];
};
export type SalesReturnRecord = {
  id: string;
  number: string;
  type: SalesReturnType;
  status: SalesReturnStatus;
  customerId: string;
  customerName: string;
  customerCode: string;
  salesInvoiceId: string | null;
  salesInvoiceNumber: string | null;
  salesOrderNumber: string;
  salesDispatchNumber: string;
  receivingWarehouseName: string;
  returnAt: Date;
  customerReference: string | null;
  notes: string | null;
  grossAmount: string;
  discountAmount: string;
  taxAmount: string;
  creditAmount: string;
  createdByName: string;
  receivedByName: string | null;
  receivedAt: Date | null;
  inspectedByName: string | null;
  inspectedAt: Date | null;
  completedByName: string | null;
  completedAt: Date | null;
  cancelledByName: string | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  lines: readonly SalesReturnLineRecord[];
};
export type SalesReturnQuery = {
  page: number;
  query: string;
  customerId?: string | undefined;
  salesInvoiceId?: string | undefined;
  status?: SalesReturnStatus | undefined;
  type?: SalesReturnType | undefined;
  dateFrom?: Date | undefined;
  dateTo?: Date | undefined;
};
export type SalesReturnPage<T> = {
  records: readonly T[];
  page: number;
  pageCount: number;
  total: number;
};
export type SalesReturnMutationResult = { ok: true; id?: string } | { ok: false; message: string };

export interface SalesReturnRepository {
  getSalesReturnReferences(): Promise<SalesReturnReferences>;
  getInvoicedReturnSource(
    invoiceId: string,
    dispatchId?: string,
  ): Promise<SalesReturnSource | null>;
  getDispatchRefusalSource(dispatchId: string): Promise<SalesReturnSource | null>;
  createSalesReturn(input: SalesReturnInput): Promise<string>;
  updateSalesReturn(input: SalesReturnInput & { id: string }): Promise<string>;
  getSalesReturn(id: string): Promise<SalesReturnRecord | null>;
  listSalesReturns(
    query: SalesReturnQuery,
  ): Promise<SalesReturnPage<Omit<SalesReturnRecord, "lines">>>;
  receiveSalesReturn(id: string, actorUserId: string): Promise<void>;
  inspectSalesReturn(
    id: string,
    inspections: readonly ReturnInspectionInput[],
    actorUserId: string,
  ): Promise<void>;
  completeSalesReturn(id: string, actorUserId: string): Promise<void>;
  cancelSalesReturn(id: string, reason: string, actorUserId: string): Promise<void>;
}
export class SalesReturnRepositoryError extends Error {
  constructor(
    readonly reason: "not-found" | "conflict" | "invalid-reference" | "invalid-state" | "stock",
    message: string,
  ) {
    super(message);
  }
}
export function requireSalesReturnManager(actor: ApplicationPrincipal) {
  return actor.active && actor.permissions.includes("sales.manage")
    ? null
    : ({ ok: false, message: "Sales management permission is required." } as const);
}
