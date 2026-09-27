"use client";

import Decimal from "decimal.js";
import { LineEditorControls } from "@/components/ui/line-editor-controls";

export type AccountOption = { id: string; code: string; name: string };

export type JournalLine = { accountId: string; description: string; debit: string; credit: string };
export type ExpenseLine = { expenseAccountId: string; description: string; amount: string };

const input = "mt-1 block min-h-11 w-full rounded-lg border border-[var(--control-border)] px-3";

function sum(values: readonly string[]) {
  return values.reduce((total, value) => {
    try {
      return value.trim() ? total.plus(new Decimal(value)) : total;
    } catch {
      return total;
    }
  }, new Decimal(0));
}

export const emptyJournalLine = (): JournalLine => ({
  accountId: "",
  description: "",
  debit: "",
  credit: "",
});

/** Serialises journal lines to the server contract: each line has exactly one positive side. */
export function journalLinesPayload(lines: readonly JournalLine[]) {
  return JSON.stringify(
    lines
      .filter((line) => line.accountId || line.debit || line.credit)
      .map((line) => ({
        accountId: line.accountId,
        ...(line.debit.trim() ? { debit: line.debit.trim() } : {}),
        ...(line.credit.trim() ? { credit: line.credit.trim() } : {}),
        ...(line.description.trim() ? { description: line.description.trim() } : {}),
      })),
  );
}

export function JournalLinesEditor({
  accounts,
  lines,
  onChange,
}: {
  accounts: readonly AccountOption[];
  lines: readonly JournalLine[];
  onChange: (lines: JournalLine[]) => void;
}) {
  const update = (index: number, patch: Partial<JournalLine>) =>
    onChange(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  const debit = sum(lines.map((line) => line.debit));
  const credit = sum(lines.map((line) => line.credit));
  const balanced = debit.equals(credit) && debit.greaterThan(0);
  return (
    <div className="space-y-3">
      {lines.map((line, index) => (
        <div
          className="grid gap-2 rounded-lg border border-[var(--control-border)] p-3 md:grid-cols-[2fr_2fr_1fr_1fr_auto] md:items-end"
          key={index}
        >
          <label className="text-sm font-medium">
            Account
            <select
              className={input}
              onChange={(event) => update(index, { accountId: event.target.value })}
              required
              value={line.accountId}
            >
              <option value="">Select account</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} — {account.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium">
            Line description
            <input
              className={input}
              onChange={(event) => update(index, { description: event.target.value })}
              value={line.description}
            />
          </label>
          <label className="text-sm font-medium">
            Debit
            <input
              className={input}
              inputMode="decimal"
              onChange={(event) => update(index, { debit: event.target.value, credit: "" })}
              value={line.debit}
            />
          </label>
          <label className="text-sm font-medium">
            Credit
            <input
              className={input}
              inputMode="decimal"
              onChange={(event) => update(index, { credit: event.target.value, debit: "" })}
              value={line.credit}
            />
          </label>
          <LineEditorControls
            onRemove={() => onChange(lines.filter((_, i) => i !== index))}
            removeDisabled={lines.length <= 2}
          />
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <LineEditorControls onAdd={() => onChange([...lines, emptyJournalLine()])} />
        <p className={`text-sm font-semibold ${balanced ? "text-green-700" : "text-red-700"}`}>
          Debit {debit.toFixed(2)} / Credit {credit.toFixed(2)}
          {balanced ? " — balanced" : ` — difference ${debit.minus(credit).abs().toFixed(2)}`}
        </p>
      </div>
    </div>
  );
}

export const emptyExpenseLine = (): ExpenseLine => ({
  expenseAccountId: "",
  description: "",
  amount: "",
});

export function ExpenseLinesEditor({
  accounts,
  lines,
  onChange,
}: {
  accounts: readonly AccountOption[];
  lines: readonly ExpenseLine[];
  onChange: (lines: ExpenseLine[]) => void;
}) {
  const update = (index: number, patch: Partial<ExpenseLine>) =>
    onChange(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  return (
    <div className="space-y-3">
      {lines.map((line, index) => (
        <div
          className="grid gap-2 rounded-lg border border-[var(--control-border)] p-3 md:grid-cols-[2fr_2fr_1fr_auto] md:items-end"
          key={index}
        >
          <label className="text-sm font-medium">
            Expense account
            <select
              className={input}
              onChange={(event) => update(index, { expenseAccountId: event.target.value })}
              required
              value={line.expenseAccountId}
            >
              <option value="">Select expense account</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} — {account.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium">
            Description
            <input
              className={input}
              onChange={(event) => update(index, { description: event.target.value })}
              required
              value={line.description}
            />
          </label>
          <label className="text-sm font-medium">
            Amount (tax included)
            <input
              className={input}
              inputMode="decimal"
              onChange={(event) => update(index, { amount: event.target.value })}
              required
              value={line.amount}
            />
          </label>
          <LineEditorControls
            onRemove={() => onChange(lines.filter((_, i) => i !== index))}
            removeDisabled={lines.length <= 1}
          />
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <LineEditorControls onAdd={() => onChange([...lines, emptyExpenseLine()])} />
        <p className="text-sm font-semibold">
          Total {sum(lines.map((line) => line.amount)).toFixed(2)}
        </p>
      </div>
    </div>
  );
}
