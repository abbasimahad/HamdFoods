import "server-only";

import Decimal from "decimal.js";
import { Prisma } from "@/generated/prisma/client";
import { SALES_ORDER_PAGE_SIZE } from "@/modules/sales/domain/sales-orders";
import { prisma } from "@/server/db/prisma";
import { CustomerPaymentRepositoryError } from "@/modules/sales/application/customer-payment-contracts";
import type {
  CustomerAging,
  CustomerPaymentInput,
  CustomerPaymentPage,
  CustomerPaymentQuery,
  CustomerPaymentRecord,
  CustomerPaymentReferences,
  CustomerPaymentRepository,
  CustomerStatement,
  OpenInvoice,
} from "@/modules/sales/application/customer-payment-contracts";

const postedAllocations = {
  where: { customerPayment: { status: "POSTED" as const } },
  include: { customerPayment: true },
};
const completedReturns = {
  where: { status: "COMPLETED" as const },
  include: { ledgerEntry: true },
};
const paymentInclude = {
  customer: true,
  createdBy: true,
  postedBy: true,
  cancelledBy: true,
  allocations: {
    include: {
      salesInvoice: {
        include: { paymentAllocations: postedAllocations, salesReturns: completedReturns },
      },
    },
  },
} satisfies Prisma.CustomerPaymentInclude;
type PaymentRow = Prisma.CustomerPaymentGetPayload<{ include: typeof paymentInclude }>;

export class PrismaCustomerPaymentRepository implements CustomerPaymentRepository {
  async getCustomerPaymentReferences(): Promise<CustomerPaymentReferences> {
    const customers = await prisma.customer.findMany({
      where: { active: true },
      select: { id: true, code: true, name: true },
      orderBy: [{ name: "asc" }, { code: "asc" }],
      take: 1000,
    });
    return { customers };
  }

  async getOpenInvoices(customerId: string): Promise<readonly OpenInvoice[]> {
    return openInvoices(prisma, customerId);
  }

  async createCustomerPayment(input: CustomerPaymentInput) {
    return serializable((transaction) => savePayment(transaction, input));
  }
  async updateCustomerPayment(input: CustomerPaymentInput & { id: string }) {
    return serializable(async (transaction) => {
      const payment = await transaction.customerPayment.findUnique({
        where: { id: input.id },
        select: { status: true },
      });
      if (!payment) throw problem("not-found", "Payment no longer exists.");
      if (payment.status !== "DRAFT")
        throw problem("invalid-state", "Only draft payments can be edited.");
      return savePayment(transaction, input);
    });
  }
  async getCustomerPayment(id: string) {
    const payment = await prisma.customerPayment.findUnique({
      where: { id },
      include: paymentInclude,
    });
    return payment ? mapPayment(payment) : null;
  }

  async listCustomerPayments(
    query: CustomerPaymentQuery,
  ): Promise<CustomerPaymentPage<Omit<CustomerPaymentRecord, "allocations">>> {
    const where = {
      ...(query.query
        ? {
            OR: [
              { number: { contains: query.query, mode: "insensitive" as const } },
              { customer: { name: { contains: query.query, mode: "insensitive" as const } } },
              { referenceNumber: { contains: query.query, mode: "insensitive" as const } },
            ],
          }
        : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.method ? { method: query.method } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            paymentDate: {
              ...(query.dateFrom ? { gte: query.dateFrom } : {}),
              ...(query.dateTo ? { lte: query.dateTo } : {}),
            },
          }
        : {}),
    };
    const [total, rows] = await prisma.$transaction([
      prisma.customerPayment.count({ where }),
      prisma.customerPayment.findMany({
        where,
        include: paymentInclude,
        orderBy: [{ paymentDate: "desc" }, { number: "desc" }],
        skip: (query.page - 1) * SALES_ORDER_PAGE_SIZE,
        take: SALES_ORDER_PAGE_SIZE,
      }),
    ]);
    return {
      records: rows.map(mapPayment),
      total,
      page: query.page,
      pageCount: Math.max(1, Math.ceil(total / SALES_ORDER_PAGE_SIZE)),
    };
  }

  async postCustomerPayment(id: string, actorUserId: string) {
    await serializable(async (transaction) => {
      const payment = await transaction.customerPayment.findUnique({
        where: { id },
        include: { customer: true, allocations: true },
      });
      if (!payment) throw problem("not-found", "Payment no longer exists.");
      if (payment.status !== "DRAFT")
        throw problem("invalid-state", "Only draft payments can be posted.");
      if (!payment.customer.active) throw problem("invalid-reference", "Customer is inactive.");
      await validateAllocations(
        transaction,
        payment.customerId,
        payment.totalAmount,
        payment.allocations,
      );
      await transaction.customerLedgerEntry.create({
        data: {
          customerId: payment.customerId,
          entryType: "CUSTOMER_PAYMENT",
          entryDate: payment.paymentDate,
          signedAmount: new Decimal(payment.totalAmount.toString()).negated().toFixed(),
          customerPaymentId: payment.id,
          referenceType: "CUSTOMER_PAYMENT",
          referenceId: payment.id,
          description: `Customer payment ${payment.number} receivable credit.`,
          createdByUserId: actorUserId,
        },
      });
      await transaction.customerPayment.update({
        where: { id },
        data: { status: "POSTED", postedByUserId: actorUserId, postedAt: new Date() },
      });
    });
  }

  async cancelCustomerPayment(id: string, reason: string, actorUserId: string) {
    await serializable(async (transaction) => {
      const payment = await transaction.customerPayment.findUnique({
        where: { id },
        select: { status: true },
      });
      if (!payment) throw problem("not-found", "Payment no longer exists.");
      if (payment.status !== "DRAFT")
        throw problem("invalid-state", "Only draft payments can be cancelled.");
      await transaction.customerPayment.update({
        where: { id },
        data: {
          status: "CANCELLED",
          cancelledByUserId: actorUserId,
          cancelledAt: new Date(),
          cancellationReason: reason,
        },
      });
    });
  }

  async allocatePostedCustomerCredit(
    id: string,
    allocations: readonly { salesInvoiceId: string; allocatedAmount: string }[],
    actorUserId: string,
  ) {
    await serializable(async (transaction) => {
      const payment = await transaction.customerPayment.findUnique({
        where: { id },
        include: { allocations: true },
      });
      if (!payment) throw problem("not-found", "Payment no longer exists.");
      if (payment.status !== "POSTED")
        throw problem("invalid-state", "Only posted payment credit can be allocated.");
      const existing = sum(payment.allocations.map((allocation) => allocation.allocatedAmount));
      const additions = await preparedAllocations(transaction, payment.customerId, allocations);
      const totalAdditions = sum(additions.map((allocation) => allocation.allocatedAmount));
      if (existing.add(totalAdditions).gt(payment.totalAmount.toString()))
        throw problem(
          "allocation",
          "Allocation exceeds the payment's remaining unallocated credit.",
        );
      await transaction.customerPaymentAllocation.createMany({
        data: additions.map((allocation) => ({
          customerPaymentId: payment.id,
          salesInvoiceId: allocation.salesInvoiceId,
          allocatedAmount: allocation.allocatedAmount,
          createdByUserId: actorUserId,
        })),
      });
    });
  }

  async getCustomerStatement(
    customerId: string,
    dateFrom?: Date,
    dateTo?: Date,
  ): Promise<CustomerStatement | null> {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { code: true, name: true },
    });
    if (!customer) return null;
    const [opening, entries] = await Promise.all([
      prisma.customerLedgerEntry.aggregate({
        where: { customerId, ...(dateFrom ? { entryDate: { lt: dateFrom } } : {}) },
        _sum: { signedAmount: true },
      }),
      prisma.customerLedgerEntry.findMany({
        where: {
          customerId,
          ...(dateFrom || dateTo
            ? {
                entryDate: {
                  ...(dateFrom ? { gte: dateFrom } : {}),
                  ...(dateTo ? { lte: dateTo } : {}),
                },
              }
            : {}),
        },
        include: { salesInvoice: true, customerPayment: true, salesReturn: true },
        orderBy: [{ entryDate: "asc" }, { createdAt: "asc" }],
      }),
    ]);
    let running = new Decimal(opening._sum.signedAmount?.toString() ?? "0");
    const rows = entries.map((entry) => {
      const amount = new Decimal(entry.signedAmount.toString());
      running = running.add(amount);
      return {
        date: entry.entryDate,
        reference:
          entry.salesInvoice?.number ??
          entry.customerPayment?.number ??
          entry.salesReturn?.number ??
          entry.referenceId,
        type: entry.entryType,
        debit: amount.gt(0) ? amount.toFixed() : "0",
        credit: amount.lt(0) ? amount.negated().toFixed() : "0",
        runningBalance: running.toFixed(),
      };
    });
    return {
      customerName: customer.name,
      customerCode: customer.code,
      openingBalance: new Decimal(opening._sum.signedAmount?.toString() ?? "0").toFixed(),
      closingBalance: running.toFixed(),
      rows,
    };
  }

  async getCustomerAging(customerId: string): Promise<CustomerAging> {
    const invoices = await openInvoices(prisma, customerId);
    const today = new Date();
    const buckets = {
      current: new Decimal(0),
      days1To30: new Decimal(0),
      days31To60: new Decimal(0),
      days61To90: new Decimal(0),
      days90Plus: new Decimal(0),
    };
    for (const invoice of invoices) {
      const amount = new Decimal(invoice.outstandingAmount);
      const days = Math.floor((today.valueOf() - invoice.dueDate.valueOf()) / 86_400_000);
      if (days <= 0) buckets.current = buckets.current.add(amount);
      else if (days <= 30) buckets.days1To30 = buckets.days1To30.add(amount);
      else if (days <= 60) buckets.days31To60 = buckets.days31To60.add(amount);
      else if (days <= 90) buckets.days61To90 = buckets.days61To90.add(amount);
      else buckets.days90Plus = buckets.days90Plus.add(amount);
    }
    return {
      current: buckets.current.toFixed(),
      days1To30: buckets.days1To30.toFixed(),
      days31To60: buckets.days31To60.toFixed(),
      days61To90: buckets.days61To90.toFixed(),
      days90Plus: buckets.days90Plus.toFixed(),
      overdue: buckets.days1To30
        .add(buckets.days31To60)
        .add(buckets.days61To90)
        .add(buckets.days90Plus)
        .toFixed(),
    };
  }
}

async function savePayment(
  transaction: Prisma.TransactionClient,
  input: CustomerPaymentInput & { id?: string },
) {
  const customer = await transaction.customer.findUnique({
    where: { id: input.customerId },
    select: { active: true },
  });
  if (!customer || !customer.active)
    throw problem("invalid-reference", "Select an active customer.");
  const paymentDate = parseDate(input.paymentDate);
  const chequeDate = input.chequeDate ? parseDate(input.chequeDate) : null;
  const totalAmount = exactPositive(input.totalAmount, "Payment amount");
  const allocations = await preparedAllocations(transaction, input.customerId, input.allocations);
  const allocatedAmount = sum(allocations.map((allocation) => allocation.allocatedAmount));
  if (allocatedAmount.gt(totalAmount))
    throw problem("allocation", "Allocated amount cannot exceed the payment amount.");
  const header = {
    customerId: input.customerId,
    paymentDate,
    method: input.method,
    totalAmount: totalAmount.toFixed(),
    referenceNumber: input.referenceNumber ?? null,
    bankName: input.bankName ?? null,
    chequeNumber: input.chequeNumber ?? null,
    chequeDate,
    notes: input.notes ?? null,
  };
  if (input.id) {
    await transaction.customerPaymentAllocation.deleteMany({
      where: { customerPaymentId: input.id },
    });
    await transaction.customerPayment.update({
      where: { id: input.id },
      data: {
        ...header,
        allocations: {
          create: allocations.map((allocation) => ({
            salesInvoiceId: allocation.salesInvoiceId,
            allocatedAmount: allocation.allocatedAmount,
            createdByUserId: input.actorUserId,
          })),
        },
      },
    });
    return input.id;
  }
  const sequence = await transaction.customerPaymentSequence.upsert({
    where: { year: paymentDate.getUTCFullYear() },
    create: { year: paymentDate.getUTCFullYear(), nextValue: 2 },
    update: { nextValue: { increment: 1 } },
  });
  return (
    await transaction.customerPayment.create({
      data: {
        number: `RCPT-${paymentDate.getUTCFullYear()}-${String(sequence.nextValue - 1).padStart(6, "0")}`,
        ...header,
        createdByUserId: input.actorUserId,
        allocations: {
          create: allocations.map((allocation) => ({
            salesInvoiceId: allocation.salesInvoiceId,
            allocatedAmount: allocation.allocatedAmount,
            createdByUserId: input.actorUserId,
          })),
        },
      },
    })
  ).id;
}

async function preparedAllocations(
  transaction: Prisma.TransactionClient,
  customerId: string,
  allocations: readonly { salesInvoiceId: string; allocatedAmount: string }[],
) {
  const invoiceIds = allocations.map((allocation) => allocation.salesInvoiceId);
  if (new Set(invoiceIds).size !== invoiceIds.length)
    throw problem("allocation", "An invoice can appear only once in an allocation request.");
  const invoices = await transaction.salesInvoice.findMany({
    where: { id: { in: invoiceIds }, customerId, status: "POSTED" },
    include: { paymentAllocations: { where: { customerPayment: { status: "POSTED" } } } },
  });
  if (invoices.length !== invoiceIds.length)
    throw problem(
      "invalid-reference",
      "Allocations must reference posted invoices for this customer.",
    );
  return allocations.map((allocation) => {
    const amount = exactPositive(allocation.allocatedAmount, "Allocation amount");
    const invoice = invoices.find((candidate) => candidate.id === allocation.salesInvoiceId)!;
    const outstanding = nonNegative(
      new Decimal(invoice.grandTotal.toString()).sub(
        sum(invoice.paymentAllocations.map((entry) => entry.allocatedAmount)),
      ),
    );
    if (amount.gt(outstanding))
      throw problem(
        "allocation",
        `Allocation exceeds outstanding amount on invoice ${invoice.number}.`,
      );
    return { salesInvoiceId: invoice.id, allocatedAmount: amount.toFixed() };
  });
}

async function validateAllocations(
  transaction: Prisma.TransactionClient,
  customerId: string,
  totalAmount: Prisma.Decimal,
  allocations: readonly { salesInvoiceId: string; allocatedAmount: Prisma.Decimal }[],
) {
  const prepared = await preparedAllocations(
    transaction,
    customerId,
    allocations.map((allocation) => ({
      salesInvoiceId: allocation.salesInvoiceId,
      allocatedAmount: allocation.allocatedAmount.toString(),
    })),
  );
  if (sum(prepared.map((allocation) => allocation.allocatedAmount)).gt(totalAmount.toString()))
    throw problem("allocation", "Allocated amount cannot exceed the payment amount.");
}
async function openInvoices(
  client: Prisma.TransactionClient | typeof prisma,
  customerId: string,
): Promise<readonly OpenInvoice[]> {
  const invoices = await client.salesInvoice.findMany({
    where: { customerId, status: "POSTED" },
    include: { paymentAllocations: postedAllocations, salesReturns: completedReturns },
    orderBy: [{ dueDate: "asc" }, { invoiceDate: "asc" }, { number: "asc" }],
  });
  return invoices
    .map((invoice) => {
      const paid = sum(invoice.paymentAllocations.map((allocation) => allocation.allocatedAmount));
      const credits = sum(
        invoice.salesReturns.map((salesReturn) =>
          salesReturn.ledgerEntry?.signedAmount
            ? new Decimal(salesReturn.ledgerEntry.signedAmount.toString()).negated()
            : new Decimal(0),
        ),
      );
      const outstanding = nonNegative(
        new Decimal(invoice.grandTotal.toString()).sub(paid).sub(credits),
      );
      return {
        id: invoice.id,
        number: invoice.number,
        invoiceDate: invoice.invoiceDate,
        dueDate: invoice.dueDate,
        originalAmount: invoice.grandTotal.toString(),
        alreadyPaid: paid.toFixed(),
        outstandingAmount: outstanding.toFixed(),
      };
    })
    .filter((invoice) => new Decimal(invoice.outstandingAmount).gt(0));
}
function mapPayment(payment: PaymentRow): CustomerPaymentRecord {
  const allocatedAmount = sum(payment.allocations.map((allocation) => allocation.allocatedAmount));
  return {
    id: payment.id,
    number: payment.number,
    customerId: payment.customerId,
    customerName: payment.customer.name,
    customerCode: payment.customer.code,
    paymentDate: payment.paymentDate,
    method: payment.method,
    totalAmount: payment.totalAmount.toString(),
    allocatedAmount: allocatedAmount.toFixed(),
    unallocatedAmount: nonNegative(
      new Decimal(payment.totalAmount.toString()).sub(allocatedAmount),
    ).toFixed(),
    referenceNumber: payment.referenceNumber,
    bankName: payment.bankName,
    chequeNumber: payment.chequeNumber,
    chequeDate: payment.chequeDate,
    notes: payment.notes,
    status: payment.status,
    createdByName: payment.createdBy.name,
    postedByName: payment.postedBy?.name ?? null,
    postedAt: payment.postedAt,
    cancelledByName: payment.cancelledBy?.name ?? null,
    cancelledAt: payment.cancelledAt,
    cancellationReason: payment.cancellationReason,
    allocations: payment.allocations.map((allocation) => {
      const paid = sum(
        allocation.salesInvoice.paymentAllocations.map((entry) => entry.allocatedAmount),
      );
      const credits = sum(
        allocation.salesInvoice.salesReturns.map((salesReturn) =>
          salesReturn.ledgerEntry?.signedAmount
            ? new Decimal(salesReturn.ledgerEntry.signedAmount.toString()).negated()
            : new Decimal(0),
        ),
      );
      return {
        id: allocation.salesInvoiceId,
        number: allocation.salesInvoice.number,
        invoiceDate: allocation.salesInvoice.invoiceDate,
        dueDate: allocation.salesInvoice.dueDate,
        originalAmount: allocation.salesInvoice.grandTotal.toString(),
        alreadyPaid: paid.toFixed(),
        outstandingAmount: nonNegative(
          new Decimal(allocation.salesInvoice.grandTotal.toString()).sub(paid).sub(credits),
        ).toFixed(),
        allocatedAmount: allocation.allocatedAmount.toString(),
      };
    }),
  };
}
function exactPositive(value: string, label: string) {
  try {
    const amount = new Decimal(value);
    if (
      !amount.isFinite() ||
      amount.lte(0) ||
      amount.decimalPlaces() > 6 ||
      amount.gt("999999999999999999.999999")
    )
      throw new Error();
    return amount;
  } catch {
    throw problem("invalid-reference", `${label} must be a positive exact amount.`);
  }
}
function parseDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw problem("invalid-reference", "Payment date is invalid.");
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value)
    throw problem("invalid-reference", "Payment date is invalid.");
  return parsed;
}
function sum(values: readonly { toString(): string }[]) {
  return values.reduce<Decimal>((total, value) => total.add(value.toString()), new Decimal(0));
}
function nonNegative(value: Decimal) {
  return Decimal.max(0, value);
}
function problem(
  reason: ConstructorParameters<typeof CustomerPaymentRepositoryError>[0],
  message: string,
) {
  return new CustomerPaymentRepositoryError(reason, message);
}
async function serializable<T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>) {
  for (let attempt = 1; attempt <= 3; attempt += 1)
    try {
      return await prisma.$transaction(operation, { isolationLevel: "Serializable" });
    } catch (caught) {
      if (
        caught instanceof Prisma.PrismaClientKnownRequestError &&
        caught.code === "P2034" &&
        attempt < 3
      )
        continue;
      if (caught instanceof Prisma.PrismaClientKnownRequestError && caught.code === "P2002")
        throw problem("conflict", "A receipt number or payment ledger entry already exists.");
      if (caught instanceof Prisma.PrismaClientKnownRequestError && caught.code === "P2025")
        throw problem("not-found", "Payment no longer exists.");
      throw caught;
    }
  throw problem("conflict", "Payment transaction conflict; retry.");
}
