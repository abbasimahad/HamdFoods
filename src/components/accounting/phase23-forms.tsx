"use client";

import { useActionState } from "react";
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
      {state ? (
        <p className={state.ok ? "text-sm text-green-700" : "text-sm text-red-700"}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
export function SupplierPaymentForm({
  suppliers,
  treasuries,
}: {
  suppliers: readonly { id: string; code: string; name: string }[];
  treasuries: readonly { id: string; code: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(saveSupplierPaymentAction, undefined);
  return (
    <form action={action} className="space-y-2">
      <div className="grid gap-2 md:grid-cols-3">
        <select className="rounded border px-3 py-2" name="supplierId" required>
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
      <button className={button} disabled={pending}>
        Save supplier-payment draft
      </button>
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
  proposal: readonly { payableLedgerEntryId: string; allocatedAmount: string }[];
}) {
  const [state, action, pending] = useActionState(allocateSupplierPaymentAction, undefined);
  const example = JSON.stringify(proposal, null, 2);
  return (
    <form action={action} className="space-y-2">
      <input name="id" type="hidden" value={paymentId} />
      <textarea
        className="min-h-28 w-full rounded border p-3 font-mono text-xs"
        name="allocationsJson"
        defaultValue={example}
      />
      <p className="text-xs text-[var(--muted)]">
        Review and confirm the server-proposed oldest-first allocation before saving. Only the
        remaining supplier advance is proposed.
      </p>
      <button className={button} disabled={pending}>
        Allocate supplier advance
      </button>
      {state ? (
        <p className={state.ok ? "text-sm text-green-700" : "text-sm text-red-700"}>
          {state.message}
        </p>
      ) : null}
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
}: {
  treasuries: readonly { id: string; code: string; name: string }[];
  accounts: readonly { id: string; code: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(saveExpenseVoucherAction, undefined);
  const example = JSON.stringify(
    [{ expenseAccountId: accounts[0]?.id ?? "", description: "Expense", amount: "0.000000" }],
    null,
    2,
  );
  return (
    <form action={action} className="space-y-2">
      <div className="grid gap-2 md:grid-cols-3">
        <input className="rounded border px-3 py-2" name="expenseDate" type="date" required />
        <input className="rounded border px-3 py-2" name="payee" placeholder="Payee" />
        <select className="rounded border px-3 py-2" name="treasuryAccountId" required>
          <option value="">Treasury account</option>
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
      <textarea
        className="min-h-32 w-full rounded border p-3 font-mono text-xs"
        defaultValue={example}
        name="linesJson"
        required
      />
      <p className="text-xs text-[var(--muted)]">
        Use exact expense-account UUIDs from the available list; tax is included in the entered
        expense amount.
      </p>
      <button className={button} disabled={pending}>
        Save expense draft
      </button>
      {state ? (
        <p className={state.ok ? "text-sm text-green-700" : "text-sm text-red-700"}>
          {state.message}
        </p>
      ) : null}
    </form>
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
