import "server-only";

import Decimal from "decimal.js";
import { prisma } from "@/server/db/prisma";
import { reconciliation } from "@/server/accounting/prisma-accounting-repository";
import { recordAuditEvent } from "@/server/audit/audit-event";
import { formatMoney } from "@/components/ui/format-money";

export type CloseReadiness = {
  period: { id: string; name: string; startDate: Date; endDate: Date; status: "OPEN" | "CLOSED" };
  checks: readonly { label: string; state: "pass" | "block" | "warning"; detail: string }[];
  canClose: boolean;
};

export class PeriodCloseError extends Error {}

export async function periodCloseReadiness(periodId: string): Promise<CloseReadiness> {
  const period = await prisma.accountingPeriod.findUnique({ where: { id: periodId } });
  if (!period) throw new PeriodCloseError("Accounting period was not found.");
  const [lines, unresolvedBlocks, nonFinalValuations, draftJournals, reconciliationRows] =
    await Promise.all([
      prisma.accountingJournalLine.findMany({
        where: {
          journal: {
            status: "POSTED",
            accountingDate: { gte: period.startDate, lte: period.endDate },
          },
        },
      }),
      prisma.accountingPostingBlock.count({
        where: {
          resolvedAt: null,
          createdAt: { gte: period.startDate, lte: endOfDay(period.endDate) },
        },
      }),
      prisma.inventoryValuationEntry.count({
        where: {
          effectiveAt: { gte: period.startDate, lte: period.endDate },
          state: { not: "FINAL" },
        },
      }),
      prisma.accountingJournal.count({
        where: { status: "DRAFT", accountingDate: { gte: period.startDate, lte: period.endDate } },
      }),
      reconciliation(),
    ]);
  const debits = lines.reduce((sum, line) => sum.add(line.debit.toString()), new Decimal(0));
  const credits = lines.reduce((sum, line) => sum.add(line.credit.toString()), new Decimal(0));
  const controlDifferences = reconciliationRows.filter(
    (row) => row.comparable && !row.difference.isZero(),
  );
  const checks = [
    {
      label: "Posted trial balance",
      state: debits.eq(credits) ? ("pass" as const) : ("block" as const),
      detail: `Debit ${formatMoney(debits, "")}; credit ${formatMoney(credits, "")}.`,
    },
    {
      label: "Unresolved posting blocks",
      state: unresolvedBlocks === 0 ? ("pass" as const) : ("block" as const),
      detail:
        unresolvedBlocks === 0
          ? "None in this period."
          : `${unresolvedBlocks} unresolved source-posting block(s) were raised during this period.`,
    },
    {
      label: "Inventory valuation finality",
      state: nonFinalValuations === 0 ? ("pass" as const) : ("block" as const),
      detail:
        nonFinalValuations === 0
          ? "All valuation entries in the period are FINAL."
          : `${nonFinalValuations} valuation entry/entries are not FINAL.`,
    },
    {
      label: "Control reconciliations",
      state: controlDifferences.length === 0 ? ("pass" as const) : ("block" as const),
      detail:
        controlDifferences.length === 0
          ? "Current comparable control balances agree."
          : `${controlDifferences.length} comparable control reconciliation difference(s) remain.`,
    },
    {
      label: "Draft journals",
      state: draftJournals === 0 ? ("pass" as const) : ("warning" as const),
      detail:
        draftJournals === 0
          ? "No draft journals are dated in this period."
          : `${draftJournals} draft journal(s) will remain unposted; they are not part of financial statements.`,
    },
  ];
  return {
    period,
    checks,
    canClose: period.status === "OPEN" && checks.every((check) => check.state !== "block"),
  };
}

export async function closeAccountingPeriod(periodId: string, actorUserId: string) {
  const readiness = await periodCloseReadiness(periodId);
  if (readiness.period.status !== "OPEN")
    throw new PeriodCloseError("Only an OPEN accounting period can be closed.");
  const blockers = readiness.checks.filter((check) => check.state === "block");
  if (blockers.length)
    throw new PeriodCloseError(
      `Period cannot close: ${blockers.map((check) => check.label).join("; ")}.`,
    );
  await prisma.$transaction(
    async (tx) => {
      const updated = await tx.accountingPeriod.updateMany({
        where: { id: periodId, status: "OPEN" },
        data: { status: "CLOSED" },
      });
      if (updated.count !== 1)
        throw new PeriodCloseError("Period status changed; reload the close checklist.");
      await tx.accountingPeriodEvent.create({ data: { periodId, action: "CLOSED", actorUserId } });
      await recordAuditEvent(tx, {
        actorUserId,
        action: "CLOSE",
        entityType: "ACCOUNTING_PERIOD",
        entityId: periodId,
        entityReference: readiness.period.name,
        module: "accounting",
        description: `Closed accounting period ${readiness.period.name}.`,
        controlEvent: true,
      });
    },
    { isolationLevel: "Serializable" },
  );
}

/**
 * ROLE-3: the open reopen request of a closed period, if any -- the latest request with no later
 * close, reopen or rejection.
 */
export function pendingReopenRequest<
  T extends { action: string; createdAt: Date; actorUserId: string; reason: string | null },
>(events: readonly T[]) {
  const latest = [...events]
    .filter((event) =>
      ["CLOSED", "REOPENED", "REOPEN_REQUESTED", "REOPEN_REJECTED"].includes(event.action),
    )
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  return latest?.action === "REOPEN_REQUESTED" ? latest : null;
}

/** Step 1 of reopening a closed period: Accounts records the request and its reason. */
export async function requestAccountingPeriodReopen(
  periodId: string,
  actorUserId: string,
  reason: string,
) {
  const trimmedReason = reason.trim();
  if (!trimmedReason)
    throw new PeriodCloseError("A reason is required to reopen an accounting period.");
  await prisma.$transaction(
    async (tx) => {
      const period = await tx.accountingPeriod.findUnique({
        where: { id: periodId },
        include: { events: true },
      });
      if (!period || period.status !== "CLOSED")
        throw new PeriodCloseError("Only a CLOSED accounting period can be reopened.");
      if (pendingReopenRequest(period.events))
        throw new PeriodCloseError(
          "A reopen request for this period is already awaiting approval.",
        );
      await tx.accountingPeriodEvent.create({
        data: { periodId, action: "REOPEN_REQUESTED", reason: trimmedReason, actorUserId },
      });
      await recordAuditEvent(tx, {
        actorUserId,
        action: "UPDATE",
        entityType: "ACCOUNTING_PERIOD",
        entityId: periodId,
        entityReference: period.name,
        module: "accounting",
        description: "Requested reopening of a closed accounting period (awaiting approval).",
        reasonCode: "ACCOUNTING_CORRECTION",
        reason: trimmedReason,
        controlEvent: true,
      });
    },
    { isolationLevel: "Serializable" },
  );
}

/**
 * Step 2: a different user with accounting_periods.reopen_approve approves (the period becomes
 * OPEN) or rejects the request. The requester can never decide their own request.
 */
export async function decideAccountingPeriodReopen(
  periodId: string,
  actorUserId: string,
  decision: "APPROVE" | "REJECT",
  note: string,
) {
  const trimmedNote = note.trim();
  if (decision === "REJECT" && !trimmedNote)
    throw new PeriodCloseError("A reason is required to reject a reopen request.");
  await prisma.$transaction(
    async (tx) => {
      const period = await tx.accountingPeriod.findUnique({
        where: { id: periodId },
        include: { events: true },
      });
      const request = period ? pendingReopenRequest(period.events) : null;
      if (!period || period.status !== "CLOSED" || !request)
        throw new PeriodCloseError("There is no reopen request awaiting approval for this period.");
      if (request.actorUserId === actorUserId)
        throw new PeriodCloseError(
          "A reopen request must be approved or rejected by someone other than the requester.",
        );
      const reason =
        decision === "APPROVE"
          ? `${request.reason ?? ""}${trimmedNote ? ` (approval note: ${trimmedNote})` : ""}`
          : trimmedNote;
      if (decision === "APPROVE") {
        const updated = await tx.accountingPeriod.updateMany({
          where: { id: periodId, status: "CLOSED" },
          data: { status: "OPEN" },
        });
        if (updated.count !== 1)
          throw new PeriodCloseError("Only a CLOSED accounting period can be reopened.");
      }
      await tx.accountingPeriodEvent.create({
        data: {
          periodId,
          action: decision === "APPROVE" ? "REOPENED" : "REOPEN_REJECTED",
          reason,
          actorUserId,
        },
      });
      await recordAuditEvent(tx, {
        actorUserId,
        action: decision === "APPROVE" ? "REOPEN" : "CANCEL",
        entityType: "ACCOUNTING_PERIOD",
        entityId: periodId,
        entityReference: period.name,
        module: "accounting",
        description:
          decision === "APPROVE"
            ? "Approved a reopen request; the accounting period is OPEN."
            : "Rejected a reopen request; the accounting period stays CLOSED.",
        reasonCode: "ACCOUNTING_CORRECTION",
        reason,
        metadata: { requestedByUserId: request.actorUserId, requestReason: request.reason },
        controlEvent: true,
      });
    },
    { isolationLevel: "Serializable" },
  );
}

function endOfDay(value: Date) {
  return new Date(`${value.toISOString().slice(0, 10)}T23:59:59.999Z`);
}
