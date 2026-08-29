import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import type { SalesInvoiceStatus } from "@/generated/prisma/client";

export type SalesInvoiceLineInput = {
  salesDispatchLineId: string;
  cartons: string;
  loosePieces: string;
  notes?: string | undefined;
};
export type SalesInvoiceInput = {
  salesOrderId: string;
  invoiceDate: string;
  notes?: string | undefined;
  lines: readonly SalesInvoiceLineInput[];
  actorUserId: string;
};
export type InvoiceableDispatchLine = {
  id: string;
  dispatchId: string;
  dispatchNumber: string;
  dispatchDate: Date;
  salesOrderLineId: string;
  itemCode: string;
  itemName: string;
  piecesPerCarton: number;
  dispatchedPieces: string;
  invoicedPieces: string;
  invoiceablePieces: string;
  allocations: readonly {
    id: string;
    lotNumber: string;
    quantity: string;
    invoicedPieces: string;
    invoiceablePieces: string;
  }[];
};
export type InvoiceOrderOption = {
  id: string;
  number: string;
  customerName: string;
  status: "PARTIALLY_DISPATCHED" | "DISPATCHED";
};
export type SalesInvoiceReferences = { orders: readonly InvoiceOrderOption[] };
export type SalesInvoiceListReferences = {
  customers: readonly { id: string; code: string; name: string }[];
  orders: readonly { id: string; number: string }[];
};
export type SalesInvoiceSourceOrder = {
  id: string;
  number: string;
  customerName: string;
  customerCode: string;
  billingAddress: string;
  deliveryAddress: string;
  paymentTermsDays: number | null;
  lines: readonly InvoiceableDispatchLine[];
};
export type SalesInvoiceLineRecord = {
  id: string;
  salesOrderLineId: string;
  salesDispatchLineId: string;
  dispatchId: string;
  dispatchNumber: string;
  itemCode: string;
  itemName: string;
  piecesPerCarton: number;
  cartons: string;
  loosePieces: string;
  totalPieces: string;
  cartonRate: string;
  pieceRate: string;
  discount1Percent: string;
  discount2Percent: string;
  taxPercent: string;
  grossAmount: string;
  discountAmount: string;
  taxAmount: string;
  netAmount: string;
  notes: string | null;
  allocations: readonly { lotNumber: string; quantity: string }[];
};
export type SalesInvoiceRecord = {
  id: string;
  number: string;
  salesOrderId: string;
  salesOrderNumber: string;
  customerId: string;
  customerName: string;
  customerCode: string;
  invoiceDate: Date;
  dueDate: Date;
  paymentTermsDays: number | null;
  salespersonName: string | null;
  areaName: string;
  routeName: string | null;
  billingAddress: string;
  deliveryAddress: string;
  status: SalesInvoiceStatus;
  notes: string | null;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  grandTotal: string;
  outstandingAmount: string;
  createdByName: string;
  postedByName: string | null;
  postedAt: Date | null;
  cancelledByName: string | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  lines: readonly SalesInvoiceLineRecord[];
};
export type SalesInvoiceQuery = {
  page: number;
  query: string;
  customerId?: string | undefined;
  salesOrderId?: string | undefined;
  status?: SalesInvoiceStatus | undefined;
  dateFrom?: Date | undefined;
  dateTo?: Date | undefined;
};
export type SalesInvoicePage<T> = {
  records: readonly T[];
  page: number;
  pageCount: number;
  total: number;
};
export interface SalesInvoiceRepository {
  getSalesInvoiceReferences(): Promise<SalesInvoiceReferences>;
  getSalesInvoiceListReferences(): Promise<SalesInvoiceListReferences>;
  getInvoiceSourceOrder(id: string): Promise<SalesInvoiceSourceOrder | null>;
  createSalesInvoice(input: SalesInvoiceInput): Promise<string>;
  updateSalesInvoice(input: SalesInvoiceInput & { id: string }): Promise<string>;
  getSalesInvoice(id: string): Promise<SalesInvoiceRecord | null>;
  listSalesInvoices(
    query: SalesInvoiceQuery,
  ): Promise<SalesInvoicePage<Omit<SalesInvoiceRecord, "lines">>>;
  postSalesInvoice(id: string, actorUserId: string): Promise<void>;
  cancelSalesInvoice(id: string, reason: string, actorUserId: string): Promise<void>;
}
export type SalesInvoiceMutationResult = { ok: true; id?: string } | { ok: false; message: string };
export class SalesInvoiceRepositoryError extends Error {
  constructor(
    readonly reason:
      "not-found" | "conflict" | "invalid-reference" | "invalid-state" | "stock" | "credit",
    message: string,
  ) {
    super(message);
  }
}
export function requireSalesInvoiceManager(actor: ApplicationPrincipal) {
  return actor.active && actor.permissions.includes("sales.manage")
    ? null
    : ({ ok: false, message: "Sales management permission is required." } as const);
}
