import Decimal from "decimal.js";
import { effectiveCustomerPaymentWhere } from "@/server/accounting/payment-effectiveness";
import { customerInvoiceSettlement } from "./customer-invoice-settlement";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/prisma";

export class CreditExposureError extends Error {}

/** Positive ledger amounts are customer receivables; future payments/credits will be negative. */
export async function customerOutstanding(
  tx: Prisma.TransactionClient | typeof prisma,
  customerId: string,
) {
  const result = await tx.customerLedgerEntry.aggregate({
    where: { customerId },
    _sum: { signedAmount: true },
  });
  return new Decimal(result._sum.signedAmount?.toString() ?? "0");
}

export async function assertCreditAvailable(
  tx: Prisma.TransactionClient,
  customerId: string,
  currentTransaction: string,
  excludeSalesOrderId?: string,
) {
  const customer = await tx.customer.findUnique({
    where: { id: customerId },
    select: { creditLimit: true },
  });
  if (!customer) throw new CreditExposureError("Customer no longer exists.");
  if (customer.creditLimit === null) return;
  const [outstanding, openOrders] = await Promise.all([
    customerOutstanding(tx, customerId),
    tx.salesOrder.findMany({
      where: {
        customerId,
        status: { in: ["APPROVED", "PARTIALLY_DISPATCHED", "DISPATCHED"] },
        ...(excludeSalesOrderId ? { id: { not: excludeSalesOrderId } } : {}),
      },
      include: {
        lines: { include: { invoiceLines: { where: { salesInvoice: { status: "POSTED" } } } } },
      },
    }),
  ]);
  const commitments = openOrders.reduce(
    (total, order) =>
      total.add(
        order.lines.reduce((lines, line) => {
          const invoiced = line.invoiceLines.reduce(
            (sum, invoiceLine) => sum.add(invoiceLine.totalPieces.toString()),
            new Decimal(0),
          );
          const remaining = Decimal.max(0, new Decimal(line.totalPieces.toString()).sub(invoiced));
          return lines.add(
            new Decimal(line.netAmount.toString()).mul(remaining).div(line.totalPieces.toString()),
          );
        }, new Decimal(0)),
      ),
    new Decimal(0),
  );
  const projected = outstanding.add(commitments).add(currentTransaction);
  if (projected.gt(customer.creditLimit.toString()))
    throw new CreditExposureError(
      `Credit limit exceeded: projected exposure ${projected.toFixed(6)} exceeds the configured limit ${customer.creditLimit.toString()}.`,
    );
}

export async function customerCreditSummary(
  tx: Prisma.TransactionClient | typeof prisma,
  customerId: string,
) {
  const [customer, outstanding] = await Promise.all([
    tx.customer.findUnique({ where: { id: customerId }, select: { creditLimit: true } }),
    customerOutstanding(tx, customerId),
  ]);
  if (!customer) throw new CreditExposureError("Customer no longer exists.");
  return {
    outstanding: outstanding.toFixed(),
    creditLimit: customer.creditLimit?.toString() ?? null,
    availableCredit:
      customer.creditLimit === null
        ? null
        : new Decimal(customer.creditLimit.toString()).sub(outstanding).toFixed(),
  };
}

export async function getCustomerReceivableSnapshot(customerId: string) {
  const [summary, invoices, payments, returns] = await Promise.all([
    customerCreditSummary(prisma, customerId),
    prisma.salesInvoice.findMany({
      where: { customerId, status: "POSTED" },
      include: {
        paymentAllocations: { where: { customerPayment: effectiveCustomerPaymentWhere() } },
        salesReturns: { where: { status: "COMPLETED" }, include: { ledgerEntry: true } },
      },
      orderBy: { invoiceDate: "desc" },
      take: 20,
    }),
    prisma.customerPayment.findMany({
      where: { customerId, ...effectiveCustomerPaymentWhere() },
      include: { allocations: true },
      orderBy: { paymentDate: "desc" },
      take: 10,
    }),
    prisma.salesReturn.findMany({
      where: { customerId, status: "COMPLETED", type: "INVOICED_RETURN" },
      include: { ledgerEntry: true },
      orderBy: { returnAt: "desc" },
      take: 10,
    }),
  ]);
  const today = new Date();
  const mapped = invoices.map((invoice) => ({
    id: invoice.id,
    number: invoice.number,
    invoiceDate: invoice.invoiceDate,
    dueDate: invoice.dueDate,
    amount: invoice.grandTotal.toString(),
    outstanding: customerInvoiceSettlement(invoice).presentationOutstanding.toFixed(),
    daysDue: Math.max(0, Math.floor((today.valueOf() - invoice.dueDate.valueOf()) / 86_400_000)),
  }));
  const unallocatedCredit = payments.reduce(
    (total, payment) =>
      total.add(
        new Decimal(payment.totalAmount.toString()).sub(
          payment.allocations.reduce(
            (allocated, allocation) => allocated.add(allocation.allocatedAmount.toString()),
            new Decimal(0),
          ),
        ),
      ),
    new Decimal(0),
  );
  return {
    ...summary,
    unallocatedCredit: unallocatedCredit.toFixed(),
    invoices: mapped,
    recentPayments: payments.map((payment) => ({
      id: payment.id,
      number: payment.number,
      paymentDate: payment.paymentDate,
      amount: payment.totalAmount.toString(),
      unallocatedAmount: new Decimal(payment.totalAmount.toString())
        .sub(
          payment.allocations.reduce(
            (allocated, allocation) => allocated.add(allocation.allocatedAmount.toString()),
            new Decimal(0),
          ),
        )
        .toFixed(),
    })),
    recentReturnCredits: returns.map((salesReturn) => ({
      id: salesReturn.id,
      number: salesReturn.number,
      returnDate: salesReturn.returnAt,
      amount: new Decimal(salesReturn.ledgerEntry?.signedAmount.toString() ?? "0")
        .negated()
        .toFixed(),
    })),
  };
}
