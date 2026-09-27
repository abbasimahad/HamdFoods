"use client";

import Decimal from "decimal.js";
import { useActionState, useState } from "react";
import {
  emptyExpenseLine,
  ExpenseLinesEditor,
  type ExpenseLine,
} from "@/components/accounting/account-lines-editor";
import { FormActions } from "@/components/ui/form-actions";
import { ActionFeedback } from "@/components/ui/action-feedback";
import {
  createTreasuryAccountAction,
  allocateSupplierPaymentAction,
  cancelExpenseVoucherAction,
  cancelSupplierPaymentAction,
  cancelTreasuryTransferAction,
  postExpenseVoucherAction,
  postSupplierPaymentAction,
  postTreasuryTransferAction,
  reverseExpenseVoucherAction,
  reverseSupplierPaymentAction,
  reverseTreasuryTransferAction,
  saveExpenseVoucherAction,
  saveSupplierPaymentAction,
  saveTreasuryTransferAction,
} from "@/app/(erp)/accounting/phase23-actions";

const button = "rounded bg-[var(--accent)] px-3 py-2 text-white";
export function TreasuryAccountForm({
  accounts,
}: {
  accounts: readonly { id: string; code: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(createTreasuryAccountAction, undefined);
  return (
    <form action={action} className="grid gap-2 md:grid-cols-3">
      <input className="rounded border px-3 py-2" name="code" placeholder="Code" required />
      <input className="rounded border px-3 py-2" name="name" placeholder="Account name" required />
      <select className="rounded border px-3 py-2" defaultValue="CASH" name="accountType">
        <option>CASH</option>
        <option>BANK</option>
        <option>PETTY_CASH</option>
        <option>CLEARING</option>
      </select>
      <select className="rounded border px-3 py-2" name="glAccountId" required>
        <option value="">Linked GL account</option>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.code} — {account.name}
          </option>
        ))}
      </select>
      <input
        className="rounded border px-3 py-2"
        name="bankName"
        placeholder="Bank name (optional)"
      />
      <input
        className="rounded border px-3 py-2"
        name="accountNumberMasked"
        placeholder="Masked account number"
      />
      <button className={button} disabled={pending}>
        Create treasury account
      </button>
      {state ? <ActionFeedback message={state.message} ok={state.ok} /> : null}
    </form>
  );
}
export function SupplierPaymentForm({
  suppliers,
  treasuries,
  supplierId,
  cancelHref = "/purchasing/supplier-payments",
}: {
  suppliers: readonly { id: string; code: string; name: string }[];
  treasuries: readonly { id: string; code: string; name: string }[];
  supplierId?: string;
  cancelHref?: string;
}) {
  const [state, action, pending] = useActionState(saveSupplierPaymentAction, undefined);
  return (
    <form action={action} className="space-y-2">
      <div className="grid gap-2 md:grid-cols-3">
        <select
          className="rounded border px-3 py-2"
          defaultValue={supplierId ?? ""}
          name="supplierId"
          required
        >
          <option value="">Supplier</option>
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.code} — {supplier.name}
            </option>
          ))}
        </select>
        <input className="rounded border px-3 py-2" name="paymentDate" type="date" required />
        <select className="rounded border px-3 py-2" name="treasuryAccountId" required>
          <option value="">Treasury account</option>
          {treasuries.map((account) => (
            <option key={account.id} value={account.id}>
              {account.code} — {account.name}
            </option>
          ))}
        </select>
        <select className="rounded border px-3 py-2" name="method" defaultValue="BANK_TRANSFER">
          <option>CASH</option>
          <option>BANK_TRANSFER</option>
          <option>CHEQUE</option>
          <option>CARD</option>
          <option>OTHER</option>
        </select>
        <input
          className="rounded border px-3 py-2"
          name="totalAmount"
          placeholder="Amount"
          required
        />
        <input
          className="rounded border px-3 py-2"
          name="referenceNumber"
          placeholder="Reference"
        />
      </div>
      <input name="allocationsJson" type="hidden" value="[]" />
      <p className="text-xs text-[var(--muted)]">
        Save a draft, then allocate payable items from its detail workflow. Unallocated value
        remains a supplier advance.
      </p>
      <FormActions
        cancelHref={cancelHref}
        disabled={pending}
        pendingLabel="Saving…"
        submitLabel="Save draft"
      />
      {state ? (
        <p className={state.ok ? "text-sm text-green-700" : "text-sm text-red-700"}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
export function PostDocumentForm({
  id,
  type,
}: {
  id: string;
  type: "payment" | "expense" | "transfer";
}) {
  const actionFn =
    type === "payment"
      ? postSupplierPaymentAction
      : type === "expense"
        ? postExpenseVoucherAction
        : postTreasuryTransferAction;
  const [state, action, pending] = useActionState(actionFn, undefined);
  return (
    <form action={action}>
      <input name="id" type="hidden" value={id} />
      <button className={button} disabled={pending}>
        Post
      </button>
      {state && !state.ok ? (
        <span className="ml-2 text-xs text-red-700">{state.message}</span>
      ) : null}
    </form>
  );
}
export function CancelDocumentForm({
  id,
  type,
}: {
  id: string;
  type: "payment" | "expense" | "transfer";
}) {
  const actionFn =
    type === "payment"
      ? cancelSupplierPaymentAction
      : type === "expense"
        ? cancelExpenseVoucherAction
        : cancelTreasuryTransferAction;
  const [state, action, pending] = useActionState(actionFn, undefined);
  return (
    <form action={action} className="mt-2 flex flex-wrap gap-2">
      <input name="id" type="hidden" value={id} />
      <input
        className="rounded border px-2 py-1 text-sm"
        name="reason"
        placeholder="Cancellation reason"
        required
      />
      <button className="rounded border px-3 py-1 text-sm" disabled={pending}>
        Cancel draft
      </button>
      {state && !state.ok ? <span className="text-xs text-red-700">{state.message}</span> : null}
    </form>
  );
}
export function SupplierPaymentAllocationForm({
  paymentId,
  proposal,
}: {
  paymentId: string;
  proposal: readonly {
    payableLedgerEntryId: string;
    allocatedAmount: string;
    sourceNumber: string;
    entryDate: string;
    outstanding: string;
  }[];
}) {
  const [state, action, pending] = useActionState(allocateSupplierPaymentAction, undefined);
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      proposal.map((item) => [
        item.payableLedgerEntryId,
        new Decimal(item.allocatedAmount).toFixed(2),
      ]),
    ),
  );
  if (!proposal.length)
    return <p className="text-sm text-[var(--muted)]">No open payables to allocate.</p>;
  const payload = JSON.stringify(
    proposal
      .filter((item) => (amounts[item.payableLedgerEntryId] ?? "").trim())
      .map((item) => ({
        payableLedgerEntryId: item.payableLedgerEntryId,
        allocatedAmount: (amounts[item.payableLedgerEntryId] ?? "").trim(),
      })),
  );
  return (
    <form action={action} className="space-y-2">
      <input name="id" type="hidden" value={paymentId} />
      <input name="allocationsJson" type="hidden" value={payload} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="p-2 text-left">Payable</th>
              <th className="p-2 text-left">Date</th>
              <th className="p-2 text-right">Outstanding</th>
              <th className="p-2 text-right">Allocate</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {proposal.map((item) => (
              <tr key={item.payableLedgerEntryId}>
                <td className="p-2">{item.sourceNumber}</td>
                <td className="p-2">{item.entryDate}</td>
                <td className="p-2 text-right">{new Decimal(item.outstanding).toFixed(2)}</td>
                <td className="p-2 text-right">
                  <input
                    aria-label={`Allocate to ${item.sourceNumber}`}
                    className="min-h-11 w-32 rounded border px-2 text-right"
                    inputMode="decimal"
                    onChange={(event) =>
                      setAmounts((current) => ({
                        ...current,
                        [item.payableLedgerEntryId]: event.target.value,
                      }))
                    }
                    value={amounts[item.payableLedgerEntryId] ?? ""}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-[var(--muted)]">
        The oldest open payables are proposed first. Adjust or clear amounts before saving; any
        unallocated value remains a supplier advance.
      </p>
      <button className={button} disabled={pending}>
        {pending ? "Allocating…" : "Allocate supplier advance"}
      </button>
      {state ? <ActionFeedback message={state.message} ok={state.ok} /> : null}
    </form>
  );
}
export function DocumentReversalForm({
  id,
  type,
}: {
  id: string;
  type: "expense" | "payment" | "transfer";
}) {
  const actionFn =
    type === "expense"
      ? reverseExpenseVoucherAction
      : type === "payment"
        ? reverseSupplierPaymentAction
        : reverseTreasuryTransferAction;
  const label =
    type === "expense" ? "expense" : type === "payment" ? "supplier payment" : "treasury transfer";
  const [state, action, pending] = useActionState(actionFn, undefined);
  return (
    <form action={action} className="mt-3 grid gap-2 md:grid-cols-3">
      <input name="id" type="hidden" value={id} />
      <input className="rounded border px-3 py-2" name="reversalDate" type="date" required />
      <input
        className="rounded border px-3 py-2 md:col-span-2"
        name="reason"
        placeholder="Reversal reason"
        required
      />
      <button className={button} disabled={pending}>
        Reverse posted {label}
      </button>
      {state ? (
        <p className={state.ok ? "text-sm text-green-700" : "text-sm text-red-700"}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
export function ExpenseReversalForm({ id }: { id: string }) {
  return <DocumentReversalForm id={id} type="expense" />;
}
export function ExpenseVoucherForm({
  treasuries,
  accounts,
  defaultDate,
}: {
  treasuries: readonly { id: string; code: string; name: string }[];
  accounts: readonly { id: string; code: string; name: string }[];
  defaultDate: string;
}) {
  const [lines, setLines] = useState<ExpenseLine[]>(() => [emptyExpenseLine()]);
  const [formKey, setFormKey] = useState(0);
  const [state, action, pending] = useActionState(
    async (
      previous: Awaited<ReturnType<typeof saveExpenseVoucherAction>> | undefined,
      form: FormData,
    ) => {
      const result = await saveExpenseVoucherAction(previous, form);
      if (result.ok) {
        setLines([emptyExpenseLine()]);
        setFormKey((key) => key + 1);
      }
      return result;
    },
    undefined,
  );
  return (
    <div className="space-y-2">
      <form action={action} className="space-y-2" key={formKey}>
        <div className="grid gap-2 md:grid-cols-3">
          <input
            className="rounded border px-3 py-2"
            defaultValue={defaultDate}
            name="expenseDate"
            type="date"
            required
          />
          <input className="rounded border px-3 py-2" name="payee" placeholder="Payee" />
          <select className="rounded border px-3 py-2" name="treasuryAccountId" required>
            <option value="">Paid from (cash / bank)</option>
            {treasuries.map((account) => (
              <option key={account.id} value={account.id}>
                {account.code} — {account.name}
              </option>
            ))}
          </select>
          <input
            className="rounded border px-3 py-2 md:col-span-2"
            name="description"
            placeholder="Voucher description"
            required
          />
          <input
            className="rounded border px-3 py-2"
            name="referenceNumber"
            placeholder="Reference"
          />
        </div>
        <input
          name="linesJson"
          type="hidden"
          value={JSON.stringify(
            lines.map((line) => ({
              expenseAccountId: line.expenseAccountId,
              description: line.description.trim(),
              amount: line.amount.trim(),
            })),
          )}
        />
        <ExpenseLinesEditor accounts={accounts} lines={lines} onChange={setLines} />
        <button className={button} disabled={pending}>
          {pending ? "Saving…" : "Save expense draft"}
        </button>
      </form>
      {state ? <ActionFeedback message={state.message} ok={state.ok} /> : null}
    </div>
  );
}
export function TreasuryTransferForm({
  treasuries,
}: {
  treasuries: readonly { id: string; code: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(saveTreasuryTransferAction, undefined);
  return (
    <form action={action} className="grid gap-2 md:grid-cols-3">
      <select className="rounded border px-3 py-2" name="sourceTreasuryAccountId" required>
        <option value="">Source account</option>
        {treasuries.map((account) => (
          <option key={account.id} value={account.id}>
            {account.code} — {account.name}
          </option>
        ))}
      </select>
      <select className="rounded border px-3 py-2" name="destinationTreasuryAccountId" required>
        <option value="">Destination account</option>
        {treasuries.map((account) => (
          <option key={account.id} value={account.id}>
            {account.code} — {account.name}
          </option>
        ))}
      </select>
      <input className="rounded border px-3 py-2" name="transferDate" type="date" required />
      <input className="rounded border px-3 py-2" name="amount" placeholder="Amount" required />
      <input className="rounded border px-3 py-2" name="referenceNumber" placeholder="Reference" />
      <input className="rounded border px-3 py-2" name="notes" placeholder="Notes" />
      <button className={button} disabled={pending}>
        Save transfer draft
      </button>
      {state ? (
        <p className={state.ok ? "text-sm text-green-700" : "text-sm text-red-700"}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
