"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  CustomerPaymentRecord,
  CustomerPaymentReferences,
  OpenInvoice,
} from "@/modules/sales/application/customer-payment-contracts";
type State = { ok: boolean; message: string };
type Action = (state: State, form: FormData) => Promise<State>;
type Allocation = { salesInvoiceId: string; allocatedAmount: string };
export function CustomerPaymentForm({
  action,
  references,
  invoices,
  initial,
  customerId,
}: {
  action: Action;
  references: CustomerPaymentReferences;
  invoices: readonly OpenInvoice[];
  initial?: CustomerPaymentRecord | undefined;
  customerId?: string | undefined;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, { ok: false, message: "" });
  const [total, setTotal] = useState(initial?.totalAmount ?? "");
  const [allocations, setAllocations] = useState<Allocation[]>(
    () =>
      initial?.allocations.map((allocation) => ({
        salesInvoiceId: allocation.id,
        allocatedAmount: allocation.allocatedAmount,
      })) ?? invoices.map((invoice) => ({ salesInvoiceId: invoice.id, allocatedAmount: "0" })),
  );
  const setAllocation = (id: string, value: string) =>
    setAllocations((current) =>
      current.map((allocation) =>
        allocation.salesInvoiceId === id ? { ...allocation, allocatedAmount: value } : allocation,
      ),
    );
  const selected = allocations.filter((allocation) => allocation.allocatedAmount !== "0");
  const allocated = selected.reduce(
    (totalAmount, allocation) => totalAmount + (Number(allocation.allocatedAmount) || 0),
    0,
  );
  const unallocated = (Number(total) || 0) - allocated;
  const autoAllocate = () => {
    let remaining = Number(total) || 0;
    setAllocations(
      invoices.map((invoice) => {
        const amount = Math.max(0, Math.min(remaining, Number(invoice.outstandingAmount)));
        remaining -= amount;
        return { salesInvoiceId: invoice.id, allocatedAmount: amount ? String(amount) : "0" };
      }),
    );
  };
  const selectedCustomerId = initial?.customerId ?? customerId ?? "";
  return (
    <form action={formAction} className="space-y-4">
      {initial && <input name="id" type="hidden" value={initial.id} />}
      <input name="customerId" type="hidden" value={selectedCustomerId} />
      <input name="allocationsJson" type="hidden" value={JSON.stringify(selected)} />
      <label className="block text-sm font-medium">
        Customer
        <select
          className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--border)] bg-white px-3 sm:max-w-xl"
          defaultValue={selectedCustomerId}
          disabled={Boolean(initial)}
          onChange={(event) => {
            if (event.target.value)
              router.push(`/sales/payments/new?customer=${event.target.value}`);
          }}
        >
          <option value="">Select</option>
          {references.customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.code} — {customer.name}
            </option>
          ))}
        </select>
      </label>
      {(initial || invoices.length || !initial) && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <label className="text-sm font-medium">
            Payment date
            <input
              className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--border)] px-3"
              defaultValue={(initial?.paymentDate ?? new Date()).toISOString().slice(0, 10)}
              name="paymentDate"
              required
              type="date"
            />
          </label>
          <label className="text-sm font-medium">
            Method
            <select
              className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--border)] bg-white px-3"
              defaultValue={initial?.method ?? "CASH"}
              name="method"
            >
              {["CASH", "BANK_TRANSFER", "CHEQUE", "CARD", "OTHER"].map((method) => (
                <option key={method}>{method}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium">
            Amount
            <input
              className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--border)] px-3"
              min="0.000001"
              name="totalAmount"
              onChange={(event) => setTotal(event.target.value)}
              required
              step="0.000001"
              type="number"
              value={total}
            />
          </label>
          <label className="text-sm font-medium">
            Reference
            <input
              className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--border)] px-3"
              defaultValue={initial?.referenceNumber ?? ""}
              maxLength={120}
              name="referenceNumber"
            />
          </label>
          <label className="text-sm font-medium">
            Bank
            <input
              className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--border)] px-3"
              defaultValue={initial?.bankName ?? ""}
              maxLength={160}
              name="bankName"
            />
          </label>
          <label className="text-sm font-medium">
            Cheque number
            <input
              className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--border)] px-3"
              defaultValue={initial?.chequeNumber ?? ""}
              maxLength={120}
              name="chequeNumber"
            />
          </label>
          <label className="text-sm font-medium">
            Cheque date
            <input
              className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--border)] px-3"
              defaultValue={initial?.chequeDate?.toISOString().slice(0, 10) ?? ""}
              name="chequeDate"
              type="date"
            />
          </label>
        </div>
      )}
      <label className="block text-sm font-medium">
        Notes
        <textarea
          className="mt-1 block min-h-24 w-full rounded-lg border border-[var(--border)] p-3"
          defaultValue={initial?.notes ?? ""}
          maxLength={1000}
          name="notes"
        />
      </label>
      {initial?.customerId || invoices.length ? (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="font-semibold">Invoice allocation</h2>
            <button
              className="min-h-11 rounded-lg border px-3 py-2 text-sm"
              onClick={autoAllocate}
              type="button"
            >
              Auto allocate oldest
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[45rem] text-left text-sm">
              <thead className="bg-[var(--surface)]">
                <tr>
                  <th className="p-3">Invoice</th>
                  <th className="p-3">Due</th>
                  <th className="p-3">Original</th>
                  <th className="p-3">Paid</th>
                  <th className="p-3">Outstanding</th>
                  <th className="p-3">Allocate</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td className="p-3">{invoice.number}</td>
                    <td className="p-3">{invoice.dueDate.toLocaleDateString()}</td>
                    <td className="p-3">{invoice.originalAmount}</td>
                    <td className="p-3">{invoice.alreadyPaid}</td>
                    <td className="p-3">{invoice.outstandingAmount}</td>
                    <td className="p-3">
                      <input
                        aria-label={`Allocate to ${invoice.number}`}
                        className="w-28 rounded border p-2"
                        min="0"
                        step="0.000001"
                        type="number"
                        value={
                          allocations.find((allocation) => allocation.salesInvoiceId === invoice.id)
                            ?.allocatedAmount ?? "0"
                        }
                        onChange={(event) => setAllocation(invoice.id, event.target.value)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={unallocated < 0 ? "text-red-700" : "text-sm"}>
            Payment {total || "0"} · Allocated {allocated} · Unallocated {unallocated}
          </p>
        </>
      ) : (
        <p className="text-sm text-[var(--muted)]">Select a customer to load open invoices.</p>
      )}
      <button
        className="min-h-11 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Saving..." : initial ? "Save draft" : "Create draft"}
      </button>
      {state.message && (
        <p aria-live="polite" className="text-sm text-red-700">
          {state.message}
        </p>
      )}
    </form>
  );
}
