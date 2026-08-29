"use client";
import { useActionState, useState } from "react";
import type {
  SalesReturnReferences,
  SalesReturnSource,
} from "@/modules/sales/application/sales-return-contracts";
import type { SalesReturnReason } from "@/generated/prisma/client";
type State = { ok: boolean; message: string };
type Action = (state: State, form: FormData) => Promise<State>;
const reasons: readonly SalesReturnReason[] = [
  "CUSTOMER_REJECTION",
  "WRONG_PRODUCT",
  "WRONG_QUANTITY",
  "DAMAGED_IN_TRANSIT",
  "PRODUCT_DEFECT",
  "PACKAGING_DEFECT",
  "EXPIRED",
  "SHORT_EXPIRY",
  "QUALITY_COMPLAINT",
  "ORDER_CANCELLED",
  "OTHER",
];
export function SalesReturnForm({
  source,
  references,
  action,
}: {
  source: SalesReturnSource;
  references: SalesReturnReferences;
  action: Action;
}) {
  const [state, formAction, pending] = useActionState(action, { ok: false, message: "" });
  const [lines, setLines] = useState(() =>
    source.lines
      .filter((line) => Number(line.returnablePieces) > 0)
      .map((line) => ({
        ...line,
        cartons: "0",
        loosePieces: "0",
        reason: "CUSTOMER_REJECTION" as SalesReturnReason,
        notes: "",
      })),
  );
  const set = (id: string, field: "cartons" | "loosePieces" | "reason" | "notes", value: string) =>
    setLines((current) =>
      current.map((line) =>
        line.salesDispatchAllocationId === id ? { ...line, [field]: value } : line,
      ),
    );
  const submitted = lines
    .filter((line) => line.cartons !== "0" || line.loosePieces !== "0")
    .map(
      ({
        salesInvoiceLineId,
        salesDispatchLineId,
        salesDispatchAllocationId,
        cartons,
        loosePieces,
        reason,
        notes,
      }) => ({
        salesInvoiceLineId: salesInvoiceLineId ?? undefined,
        salesDispatchLineId,
        salesDispatchAllocationId,
        cartons,
        loosePieces,
        reason,
        notes: notes || undefined,
      }),
    );
  return (
    <form action={formAction} className="space-y-4">
      <input name="type" type="hidden" value={source.type} />
      <input
        name="salesInvoiceId"
        type="hidden"
        value={source.type === "INVOICED_RETURN" ? source.sourceId : ""}
      />
      <input name="salesDispatchId" type="hidden" value={source.salesDispatchId} />
      <input name="linesJson" type="hidden" value={JSON.stringify(submitted)} />
      <div className="rounded-lg bg-[var(--surface)] p-3 text-sm">
        <strong>
          {source.type === "INVOICED_RETURN" ? "Invoiced return" : "Pre-invoice dispatch refusal"}
        </strong>
        <br />
        {source.customerName} — {source.sourceNumber}.{" "}
        {source.type === "DISPATCH_REFUSAL" && "No financial credit will be created."}
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm font-medium">
          Return date
          <input
            className="mt-1 min-h-11 w-full rounded border p-2"
            defaultValue={new Date().toISOString().slice(0, 10)}
            name="returnDate"
            required
            type="date"
          />
        </label>
        <label className="text-sm font-medium">
          Receiving warehouse
          <select
            className="mt-1 min-h-11 w-full rounded border bg-white p-2"
            defaultValue={source.warehouseId}
            name="receivingWarehouseId"
          >
            {references.warehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.code} — {warehouse.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium">
          Customer reference
          <input
            className="mt-1 min-h-11 w-full rounded border p-2"
            name="customerReference"
            maxLength={120}
          />
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[65rem] text-left text-sm">
          <thead className="bg-[var(--surface)]">
            <tr>
              <th className="p-3">Product / lot</th>
              <th className="p-3">Returnable</th>
              <th className="p-3">Cartons</th>
              <th className="p-3">Loose</th>
              <th className="p-3">Reason</th>
              <th className="p-3">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {lines.map((line) => (
              <tr key={line.salesDispatchAllocationId}>
                <td className="p-3">
                  <strong>{line.itemCode}</strong>
                  <span className="block text-xs">
                    {line.itemName} · Lot {line.lotNumber}
                  </span>
                </td>
                <td className="p-3">{line.returnablePieces} pcs</td>
                <td className="p-3">
                  <input
                    className="w-20 rounded border p-2"
                    min="0"
                    step="1"
                    type="number"
                    value={line.cartons}
                    onChange={(event) =>
                      set(line.salesDispatchAllocationId, "cartons", event.target.value)
                    }
                  />
                </td>
                <td className="p-3">
                  <input
                    className="w-20 rounded border p-2"
                    min="0"
                    step="1"
                    type="number"
                    value={line.loosePieces}
                    onChange={(event) =>
                      set(line.salesDispatchAllocationId, "loosePieces", event.target.value)
                    }
                  />
                </td>
                <td className="p-3">
                  <select
                    className="rounded border bg-white p-2"
                    value={line.reason}
                    onChange={(event) =>
                      set(line.salesDispatchAllocationId, "reason", event.target.value)
                    }
                  >
                    {reasons.map((reason) => (
                      <option key={reason}>{reason}</option>
                    ))}
                  </select>
                </td>
                <td className="p-3">
                  <input
                    className="rounded border p-2"
                    maxLength={1000}
                    value={line.notes}
                    onChange={(event) =>
                      set(line.salesDispatchAllocationId, "notes", event.target.value)
                    }
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
          className="mt-1 block min-h-24 w-full rounded border p-3"
          name="notes"
          maxLength={1000}
        />
      </label>
      <button
        className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Saving..." : "Create draft return"}
      </button>
      {state.message && (
        <p aria-live="polite" className="text-sm text-red-700">
          {state.message}
        </p>
      )}
    </form>
  );
}
