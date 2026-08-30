import Decimal from "decimal.js";
import { expect } from "vitest";

export function expectBalancedJournal(journal: {
  totalDebit: string;
  totalCredit: string;
  lines: { create: readonly { debit: string; credit: string }[] };
}) {
  const debit = journal.lines.create.reduce((sum, line) => sum.add(line.debit), new Decimal(0));
  const credit = journal.lines.create.reduce((sum, line) => sum.add(line.credit), new Decimal(0));
  expect(debit.toFixed(6)).toBe(journal.totalDebit);
  expect(credit.toFixed(6)).toBe(journal.totalCredit);
  expect(debit.eq(credit)).toBe(true);
}
