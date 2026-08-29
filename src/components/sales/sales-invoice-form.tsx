"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  SalesInvoiceRecord,
  SalesInvoiceReferences,
  SalesInvoiceSourceOrder,
} from "@/modules/sales/application/sales-invoice-contracts";

type State = { ok: boolean; message: string };
type Action = (state: State, form: FormData) => Promise<State>;
type EditableLine = { salesDispatchLineId: string; cartons: string; loosePieces: string };

export function SalesInvoiceForm({
  action,
  references,
  order,
  initial,
}: {
  action: Action;
  references: SalesInvoiceReferences;
  order: SalesInvoiceSourceOrder | null;
  initial?: SalesInvoiceRecord;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, { ok: false, message: "" });
  const [lines, setLines] = useState<EditableLine[]>(
    () =>
      initial?.lines.map((line) => ({
        salesDispatchLineId: line.salesDispatchLineId,
        cartons: line.cartons,
        loosePieces: line.loosePieces,
      })) ??
      order?.lines.map((line) => ({
        salesDispatchLineId: line.id,
        cartons: "0",
        loosePieces: "0",
      })) ??
      [],
  );
  const submittedLines = lines.filter((line) => line.cartons !== "0" || line.loosePieces !== "0");
  const change = (id: string, field: "cartons" | "loosePieces", value: string) =>
    setLines((current) =>
      current.map((line) => (line.salesDispatchLineId === id ? { ...line, [field]: value } : line)),
    );

  return (
    <form action={formAction} className="space-y-4">
      {initial && <input name="id" type="hidden" value={initial.id} />}
      <input name="salesOrderId" type="hidden" value={order?.id ?? initial?.salesOrderId ?? ""} />
      <input name="linesJson" type="hidden" value={JSON.stringify(submittedLines)} />
      <label className="block text-sm font-medium">
        Sales Order
        <select
          className="ml-2 min-h-11 rounded-lg border border-[var(--border)] bg-white px-3"
          defaultValue={order?.id ?? ""}
          disabled={Boolean(initial)}
          onChange={(event) => {
            if (event.target.value) router.push(`/sales/invoices/new?order=${event.target.value}`);
          }}
        >
          <option value="">Select</option>
          {references.orders.map((reference) => (
            <option key={reference.id} value={reference.id}>
              {reference.number} — {reference.customerName}
            </option>
          ))}
        </select>
      </label>
      {order && (
        <>
          <div className="rounded-lg bg-[var(--surface)] p-3 text-sm">
            {order.number} — {order.customerName}. Quantities are limited to posted dispatch
            quantities not already invoiced.
          </div>
          <label className="block text-sm font-medium">
            Invoice date
            <input
              className="ml-2 min-h-11 rounded-lg border border-[var(--border)] px-3"
              defaultValue={(initial?.invoiceDate ?? new Date()).toISOString().slice(0, 10)}
              name="invoiceDate"
              type="date"
              required
            />
          </label>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[50rem] text-left text-sm">
              <thead className="bg-[var(--surface)]">
                <tr>
                  <th className="p-3">Dispatch / product</th>
                  <th className="p-3">Invoiceable pieces</th>
                  <th className="p-3">Cartons</th>
                  <th className="p-3">Loose pieces</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {order.lines.map((line) => (
                  <tr key={line.id}>
                    <td className="p-3">
                      <strong>{line.dispatchNumber}</strong>
                      <span className="block text-xs">
                        {line.itemCode} — {line.itemName}
                      </span>
                    </td>
                    <td className="p-3">{line.invoiceablePieces}</td>
                    <td className="p-3">
                      <input
                        aria-label={`${line.itemName} cartons`}
                        className="w-24 rounded border p-2"
                        min="0"
                        step="1"
                        type="number"
                        value={
                          lines.find((entry) => entry.salesDispatchLineId === line.id)?.cartons ??
                          "0"
                        }
                        onChange={(event) => change(line.id, "cartons", event.target.value)}
                      />
                    </td>
                    <td className="p-3">
                      <input
                        aria-label={`${line.itemName} loose pieces`}
                        className="w-24 rounded border p-2"
                        min="0"
                        step="1"
                        type="number"
                        value={
                          lines.find((entry) => entry.salesDispatchLineId === line.id)
                            ?.loosePieces ?? "0"
                        }
                        onChange={(event) => change(line.id, "loosePieces", event.target.value)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label className="block text-sm font-medium">
            Notes
            <textarea
              className="mt-1 block min-h-24 w-full rounded-lg border border-[var(--border)] p-3"
              defaultValue={initial?.notes ?? ""}
              name="notes"
              maxLength={1000}
            />
          </label>
          <button
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            disabled={pending}
            type="submit"
          >
            {pending ? "Saving..." : initial ? "Save draft" : "Create draft"}
          </button>
        </>
      )}
      {state.message && (
        <p aria-live="polite" className="text-sm text-red-700">
          {state.message}
        </p>
      )}
    </form>
  );
}
