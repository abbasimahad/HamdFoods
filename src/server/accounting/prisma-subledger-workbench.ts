import "server-only";

import Decimal from "decimal.js";

import type {
  PayablePartyDetail,
  PayablePartySummary,
  ReceivablePartyDetail,
  ReceivablePartySummary,
  SubledgerAging,
  SubledgerHistoryRow,
  SubledgerPartyPage,
  SubledgerWorkbenchQuery,
} from "@/modules/accounting/application/subledger-workbench-contracts";
import {
  effectiveCustomerPaymentWhere,
  effectiveSupplierPaymentWhere,
} from "./payment-effectiveness";
import { prisma } from "@/server/db/prisma";

export type SubledgerKind = "receivable" | "payable";
export type SubledgerParty = { id: string; code: string; name: string };
export type SubledgerAllocation = { amount: string; date: Date; effective: boolean };
export type SubledgerDocument = {
  id: string;
  number: string;
  date: Date;
  dueDate: Date;
  amount: string;
  allocations: readonly SubledgerAllocation[];
  credits: readonly SubledgerAllocation[];
  effective: boolean;
};
export type SubledgerEvent = {
  id: string;
  date: Date;
  number: string;
  type: string;
  description: string;
  signedAmount: string;
  effective: boolean;
};
export type SubledgerPartyData = {
  partyId: string;
  documents: readonly SubledgerDocument[];
  ledger: readonly SubledgerEvent[];
  allocations: readonly SubledgerEvent[];
};
export type SubledgerWorkbenchSource = {
  listParties(
    kind: SubledgerKind,
    query: string,
    page: number,
    pageSize: number,
  ): Promise<{ records: readonly SubledgerParty[]; total: number }>;
  getParty(kind: SubledgerKind, id: string): Promise<SubledgerParty | null>;
  loadPartyData(
    kind: SubledgerKind,
    partyIds: readonly string[],
    asOf: Date,
  ): Promise<readonly SubledgerPartyData[]>;
};

const PAGE_SIZE = 30;

export class PrismaSubledgerWorkbench {
  constructor(private readonly source: SubledgerWorkbenchSource = prismaSource) {}

  async listReceivables(
    query: SubledgerWorkbenchQuery,
  ): Promise<SubledgerPartyPage<ReceivablePartySummary>> {
    return this.list("receivable", query);
  }

  async listPayables(
    query: SubledgerWorkbenchQuery,
  ): Promise<SubledgerPartyPage<PayablePartySummary>> {
    return this.list("payable", query);
  }

  async getReceivable(customerId: string, asOf: Date): Promise<ReceivablePartyDetail | null> {
    return this.get("receivable", customerId, asOf);
  }

  async getPayable(supplierId: string, asOf: Date): Promise<PayablePartyDetail | null> {
    return this.get("payable", supplierId, asOf);
  }

  private async list(kind: SubledgerKind, query: SubledgerWorkbenchQuery) {
    const normalizedQuery = query.query.trim();
    const page = Math.max(1, Math.trunc(query.page) || 1);
    const parties = await this.source.listParties(kind, normalizedQuery, page, PAGE_SIZE);
    const data = await this.source.loadPartyData(
      kind,
      parties.records.map((party) => party.id),
      query.asOf,
    );
    const byParty = new Map(data.map((row) => [row.partyId, row]));
    return {
      records: parties.records.map((party) => summarize(party, byParty.get(party.id), query.asOf)),
      page,
      pageCount: Math.max(1, Math.ceil(parties.total / PAGE_SIZE)),
      total: parties.total,
    };
  }

  private async get(kind: SubledgerKind, id: string, asOf: Date) {
    const party = await this.source.getParty(kind, id);
    if (!party) return null;
    const [data] = await this.source.loadPartyData(kind, [id], asOf);
    return {
      ...summarize(party, data, asOf),
      history: history(data, asOf),
    };
  }
}

function summarize(party: SubledgerParty, data: SubledgerPartyData | undefined, asOf: Date) {
  const documents = (data?.documents ?? []).flatMap((document) => {
    if (!document.effective || document.date > asOf) return [];
    const allocated = sum(
      document.allocations
        .filter((row) => row.effective && row.date <= asOf)
        .map((row) => row.amount),
    );
    const credited = sum(
      document.credits.filter((row) => row.effective && row.date <= asOf).map((row) => row.amount),
    );
    const outstanding = Decimal.max(0, new Decimal(document.amount).sub(allocated).sub(credited));
    return outstanding.gt(0) ? [{ dueDate: document.dueDate, outstanding }] : [];
  });
  const outstanding = sum(documents.map((row) => row.outstanding));
  const net = sum(
    (data?.ledger ?? [])
      .filter((row) => row.effective && row.date <= asOf)
      .map((row) => row.signedAmount),
  );
  const credits = Decimal.max(0, outstanding.sub(net));
  return {
    partyId: party.id,
    code: party.code,
    name: party.name,
    outstandingBalance: format(outstanding),
    creditsAvailable: format(credits),
    netBalance: format(net),
    aging: aging(documents, asOf),
  };
}

function history(data: SubledgerPartyData | undefined, asOf: Date): readonly SubledgerHistoryRow[] {
  return [...(data?.ledger ?? []), ...(data?.allocations ?? [])]
    .filter((row) => row.effective && row.date <= asOf)
    .sort(
      (left, right) =>
        left.date.getTime() - right.date.getTime() || left.number.localeCompare(right.number),
    )
    .map((row) => {
      const amount = new Decimal(row.signedAmount);
      return {
        id: row.id,
        date: row.date,
        number: row.number,
        type: row.type,
        description: row.description,
        debit: format(Decimal.max(0, amount)),
        credit: format(Decimal.max(0, amount.negated())),
        amount: format(amount),
      };
    });
}

function aging(
  documents: readonly { dueDate: Date; outstanding: Decimal }[],
  asOf: Date,
): SubledgerAging {
  const buckets = {
    current: new Decimal(0),
    days1To30: new Decimal(0),
    days31To60: new Decimal(0),
    days61To90: new Decimal(0),
    days90Plus: new Decimal(0),
  };
  for (const document of documents) {
    const days = Math.floor((asOf.getTime() - document.dueDate.getTime()) / 86_400_000);
    const key =
      days <= 0
        ? "current"
        : days <= 30
          ? "days1To30"
          : days <= 60
            ? "days31To60"
            : days <= 90
              ? "days61To90"
              : "days90Plus";
    buckets[key] = buckets[key].add(document.outstanding);
  }
  return {
    current: format(buckets.current),
    days1To30: format(buckets.days1To30),
    days31To60: format(buckets.days31To60),
    days61To90: format(buckets.days61To90),
    days90Plus: format(buckets.days90Plus),
    total: format(sum(documents.map((row) => row.outstanding))),
  };
}

function sum(values: readonly (string | Decimal)[]) {
  return values.reduce<Decimal>((total, value) => total.add(value), new Decimal(0));
}

function format(value: Decimal) {
  return value.toFixed(6);
}

const prismaSource: SubledgerWorkbenchSource = {
  async listParties(kind, query, page, pageSize) {
    const where = query
      ? {
          OR: [
            { code: { contains: query, mode: "insensitive" as const } },
            { name: { contains: query, mode: "insensitive" as const } },
          ],
        }
      : {};
    if (kind === "receivable") {
      const [total, records] = await Promise.all([
        prisma.customer.count({ where }),
        prisma.customer.findMany({
          where,
          select: { id: true, code: true, name: true },
          orderBy: { code: "asc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
      return { records, total };
    }
    const [total, records] = await Promise.all([
      prisma.supplier.count({ where }),
      prisma.supplier.findMany({
        where,
        select: { id: true, code: true, name: true },
        orderBy: { code: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { records, total };
  },
  async getParty(kind, id) {
    const select = { id: true, code: true, name: true } as const;
    return kind === "receivable"
      ? prisma.customer.findUnique({ where: { id }, select })
      : prisma.supplier.findUnique({ where: { id }, select });
  },
  async loadPartyData(kind, partyIds, asOf) {
    if (!partyIds.length) return [];
    return kind === "receivable"
      ? loadReceivableData(partyIds, asOf)
      : loadPayableData(partyIds, asOf);
  },
};

async function loadReceivableData(partyIds: readonly string[], asOf: Date) {
  const [invoices, ledger, allocations] = await Promise.all([
    prisma.salesInvoice.findMany({
      where: { customerId: { in: [...partyIds] }, status: "POSTED", invoiceDate: { lte: asOf } },
      include: {
        paymentAllocations: {
          where: { customerPayment: effectiveCustomerPaymentWhere(asOf) },
          include: { customerPayment: true },
        },
        salesReturns: {
          where: { status: "COMPLETED", ledgerEntry: { entryDate: { lte: asOf } } },
          include: { ledgerEntry: true },
        },
      },
    }),
    prisma.customerLedgerEntry.findMany({
      where: { customerId: { in: [...partyIds] }, entryDate: { lte: asOf } },
      include: { salesInvoice: true, customerPayment: true, salesReturn: true },
    }),
    prisma.customerPaymentAllocation.findMany({
      where: {
        customerPayment: {
          customerId: { in: [...partyIds] },
          ...effectiveCustomerPaymentWhere(asOf),
        },
      },
      include: { customerPayment: true, salesInvoice: true },
    }),
  ]);
  return partyIds.map((partyId) => ({
    partyId,
    documents: invoices
      .filter((row) => row.customerId === partyId)
      .map((row) => ({
        id: row.id,
        number: row.number,
        date: row.invoiceDate,
        dueDate: row.dueDate,
        amount: row.grandTotal.toString(),
        allocations: row.paymentAllocations.map((line) => ({
          amount: line.allocatedAmount.toString(),
          date: line.customerPayment.paymentDate,
          effective: true,
        })),
        credits: row.salesReturns.flatMap((saleReturn) =>
          saleReturn.ledgerEntry
            ? [
                {
                  amount: new Decimal(saleReturn.ledgerEntry.signedAmount.toString())
                    .abs()
                    .toFixed(),
                  date: saleReturn.ledgerEntry.entryDate,
                  effective: true,
                },
              ]
            : [],
        ),
        effective: true,
      })),
    ledger: ledger
      .filter((row) => row.customerId === partyId)
      .map((row) => ({
        id:
          row.salesInvoice?.id ?? row.customerPayment?.id ?? row.salesReturn?.id ?? row.referenceId,
        date: row.entryDate,
        number:
          row.salesInvoice?.number ??
          row.customerPayment?.number ??
          row.salesReturn?.number ??
          row.referenceId,
        type: row.entryType,
        description: row.description,
        signedAmount: row.signedAmount.toString(),
        effective: true,
      })),
    allocations: allocations
      .filter((row) => row.customerPayment.customerId === partyId)
      .map((row) => ({
        id: row.id,
        date: row.customerPayment.paymentDate,
        number: `${row.customerPayment.number} → ${row.salesInvoice.number}`,
        type: "ALLOCATION",
        description: "Customer payment allocation",
        signedAmount: new Decimal(row.allocatedAmount.toString()).negated().toFixed(),
        effective: true,
      })),
  }));
}

async function loadPayableData(partyIds: readonly string[], asOf: Date) {
  const [documents, ledger, allocations] = await Promise.all([
    prisma.supplierPayableLedgerEntry.findMany({
      where: {
        supplierId: { in: [...partyIds] },
        signedAmount: { gt: 0 },
        sourceType: { not: "SUPPLIER_PAYMENT_REVERSAL" },
        entryDate: { lte: asOf },
      },
      include: {
        allocations: {
          where: { supplierPayment: effectiveSupplierPaymentWhere(asOf) },
          include: { supplierPayment: true },
        },
      },
    }),
    prisma.supplierPayableLedgerEntry.findMany({
      where: { supplierId: { in: [...partyIds] }, entryDate: { lte: asOf } },
    }),
    prisma.supplierPaymentAllocation.findMany({
      where: {
        payableLedgerEntry: { supplierId: { in: [...partyIds] } },
        supplierPayment: effectiveSupplierPaymentWhere(asOf),
      },
      include: { supplierPayment: true, payableLedgerEntry: true },
    }),
  ]);
  return partyIds.map((partyId) => ({
    partyId,
    documents: documents
      .filter((row) => row.supplierId === partyId)
      .map((row) => ({
        id: row.id,
        number: row.sourceNumber ?? row.sourceId,
        date: row.entryDate,
        dueDate: row.entryDate,
        amount: row.signedAmount.toString(),
        allocations: row.allocations.map((line) => ({
          amount: line.allocatedAmount.toString(),
          date: line.supplierPayment.paymentDate,
          effective: true,
        })),
        credits: [],
        effective: true,
      })),
    ledger: ledger
      .filter((row) => row.supplierId === partyId)
      .map((row) => ({
        id: row.sourceId,
        date: row.entryDate,
        number: row.sourceNumber ?? row.sourceId,
        type: row.entryType,
        description: row.description,
        signedAmount: row.signedAmount.toString(),
        effective: true,
      })),
    allocations: allocations
      .filter((row) => row.payableLedgerEntry.supplierId === partyId)
      .map((row) => ({
        id: row.id,
        date: row.supplierPayment.paymentDate,
        number: `${row.supplierPayment.number} → ${row.payableLedgerEntry.sourceNumber ?? row.payableLedgerEntry.sourceId}`,
        type: "ALLOCATION",
        description: "Supplier payment allocation",
        signedAmount: new Decimal(row.allocatedAmount.toString()).negated().toFixed(),
        effective: true,
      })),
  }));
}
