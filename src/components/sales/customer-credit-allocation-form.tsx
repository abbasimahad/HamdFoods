"use client";
import { useActionState, useState } from "react";
import type { OpenInvoice } from "@/modules/sales/application/customer-payment-contracts";
type State = { ok: boolean; message: string };
type Action = (state: State, form: FormData) => Promise<State>;
export function CustomerCreditAllocationForm({
  action,
  paymentId,
  customerId,
  availableCredit,
  invoices,
}: {
  action: Action;
  paymentId: string;
  customerId: string;
  availableCredit: string;
  invoices: readonly OpenInvoice[];
}) {
  const [state, formAction, pending] = useActionState(action, { ok: false, message: "" });
  const [allocations, setAllocations] = useState(() =>
    invoices.map((invoice) => ({ salesInvoiceId: invoice.id, allocatedAmount: "0" })),
  );
  const selected = allocations.filter((allocation) => allocation.allocatedAmount !== "0");
  const allocated = selected.reduce(
    (total, allocation) => total + (Number(allocation.allocatedAmount) || 0),
    0,
  );
  const auto = () => {
    let remaining = Number(availableCredit);
    setAllocations(
      invoices.map((invoice) => {
        const amount = Math.max(0, Math.min(remaining, Number(invoice.outstandingAmount)));
        remaining -= amount;
        return { salesInvoiceId: invoice.id, allocatedAmount: amount ? String(amount) : "0" };
      }),
    );
  };
  return (
    <form action={formAction} className="space-y-3">
      <input name="id" type="hidden" value={paymentId} />
      <input name="customerId" type="hidden" value={customerId} />
      <input name="allocationsJson" type="hidden" value={JSON.stringify(selected)} />
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Allocate unallocated credit ({availableCredit})</h2>
        <button className="rounded-lg border px-3 py-2 text-sm" onClick={auto} type="button">
          Auto allocate oldest
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[38rem] text-left text-sm">
          <thead className="bg-[var(--surface)]">
            <tr>
              <th className="p-3">Invoice</th>
              <th className="p-3">Due</th>
              <th className="p-3">Outstanding</th>
              <th className="p-3">Allocate</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {invoices.map((invoice) => (
              <tr key={invoice.id}>
                <td className="p-3">{invoice.number}</td>
                <td className="p-3">{invoice.dueDate.toLocaleDateString()}</td>
                <td className="p-3">{invoice.outstandingAmount}</td>
                <td className="p-3">
                  <input
                    className="w-28 rounded border p-2"
                    min="0"
                    step="0.000001"
                    type="number"
                    value={
                      allocations.find((allocation) => allocation.salesInvoiceId === invoice.id)
                        ?.allocatedAmount ?? "0"
                    }
                    onChange={(event) =>
                      setAllocations((current) =>
                        current.map((allocation) =>
                          allocation.salesInvoiceId === invoice.id
                            ? { ...allocation, allocatedAmount: event.target.value }
                            : allocation,
                        ),
                      )
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={allocated > Number(availableCredit) ? "text-sm text-red-700" : "text-sm"}>
        Selected: {allocated}
      </p>
      <button
        className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
        disabled={pending}
        type="submit"
      >
        {pending ? "Allocating..." : "Allocate credit"}
      </button>
      {state.message && (
        <p aria-live="polite" className="text-sm text-red-700">
          {state.message}
        </p>
      )}
    </form>
  );
}
