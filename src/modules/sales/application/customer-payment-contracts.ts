import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import type { CustomerPaymentMethod, CustomerPaymentStatus } from "@/generated/prisma/client";

export type CustomerPaymentAllocationInput = { salesInvoiceId: string; allocatedAmount: string };
export type CustomerPaymentInput = {
  customerId: string;
  paymentDate: string;
  method: CustomerPaymentMethod;
  totalAmount: string;
  referenceNumber?: string | undefined;
  bankName?: string | undefined;
  chequeNumber?: string | undefined;
  chequeDate?: string | undefined;
  notes?: string | undefined;
  allocations: readonly CustomerPaymentAllocationInput[];
  actorUserId: string;
};
export type PaymentCustomerOption = { id: string; code: string; name: string };
export type OpenInvoice = {
  id: string;
  number: string;
  invoiceDate: Date;
  dueDate: Date;
  originalAmount: string;
  alreadyPaid: string;
  outstandingAmount: string;
};
export type CustomerPaymentReferences = { customers: readonly PaymentCustomerOption[] };
export type CustomerPaymentAllocationRecord = OpenInvoice & { allocatedAmount: string };
export type CustomerPaymentRecord = {
  id: string;
  number: string;
  customerId: string;
  customerName: string;
  customerCode: string;
  paymentDate: Date;
  method: CustomerPaymentMethod;
  totalAmount: string;
  allocatedAmount: string;
  unallocatedAmount: string;
  referenceNumber: string | null;
  bankName: string | null;
  chequeNumber: string | null;
  chequeDate: Date | null;
  notes: string | null;
  status: CustomerPaymentStatus;
  createdByName: string;
  postedByName: string | null;
  postedAt: Date | null;
  cancelledByName: string | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  reversalOfNumber: string | null;
  reversalPaymentNumber: string | null;
  reversalReason: string | null;
  allocations: readonly CustomerPaymentAllocationRecord[];
};
export type CustomerPaymentQuery = {
  page: number;
  query: string;
  customerId?: string | undefined;
  method?: CustomerPaymentMethod | undefined;
  status?: CustomerPaymentStatus | undefined;
  dateFrom?: Date | undefined;
  dateTo?: Date | undefined;
};
export type CustomerPaymentPage<T> = {
  records: readonly T[];
  page: number;
  pageCount: number;
  total: number;
};
export type CustomerStatementRow = {
  date: Date;
  reference: string;
  type: string;
  debit: string;
  credit: string;
  runningBalance: string;
};
export type CustomerStatement = {
  customerName: string;
  customerCode: string;
  openingBalance: string;
  closingBalance: string;
  rows: readonly CustomerStatementRow[];
};
export type CustomerAging = {
  current: string;
  days1To30: string;
  days31To60: string;
  days61To90: string;
  days90Plus: string;
  overdue: string;
};

export interface CustomerPaymentRepository {
  getCustomerPaymentReferences(): Promise<CustomerPaymentReferences>;
  getOpenInvoices(customerId: string, paymentId?: string): Promise<readonly OpenInvoice[]>;
  createCustomerPayment(input: CustomerPaymentInput): Promise<string>;
  updateCustomerPayment(input: CustomerPaymentInput & { id: string }): Promise<string>;
  getCustomerPayment(id: string): Promise<CustomerPaymentRecord | null>;
  listCustomerPayments(
    query: CustomerPaymentQuery,
  ): Promise<CustomerPaymentPage<Omit<CustomerPaymentRecord, "allocations">>>;
  postCustomerPayment(id: string, actorUserId: string): Promise<void>;
  cancelCustomerPayment(id: string, reason: string, actorUserId: string): Promise<void>;
  reverseCustomerPayment(
    id: string,
    actorUserId: string,
    reversalDate: Date,
    reason: string,
  ): Promise<string>;
  allocatePostedCustomerCredit(
    id: string,
    allocations: readonly CustomerPaymentAllocationInput[],
    actorUserId: string,
  ): Promise<void>;
  getCustomerStatement(
    customerId: string,
    dateFrom?: Date,
    dateTo?: Date,
  ): Promise<CustomerStatement | null>;
  getCustomerAging(customerId: string): Promise<CustomerAging>;
}
export type CustomerPaymentMutationResult =
  { ok: true; id?: string } | { ok: false; message: string };
export class CustomerPaymentRepositoryError extends Error {
  constructor(
    readonly reason:
      "not-found" | "conflict" | "invalid-reference" | "invalid-state" | "allocation",
    message: string,
  ) {
    super(message);
  }
}
export function requireCustomerPaymentManager(actor: ApplicationPrincipal) {
  return actor.active && actor.permissions.includes("sales.manage")
    ? null
    : ({ ok: false, message: "Sales management permission is required." } as const);
}
