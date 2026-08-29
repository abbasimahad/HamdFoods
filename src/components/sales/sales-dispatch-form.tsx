"use client";

import { useActionState, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Decimal from "decimal.js";
import { normalizeCartonQuantity } from "@/modules/quantity/domain/cartons";
import type {
  DispatchOrderLine,
  SalesDispatchRecord,
  SalesDispatchReferences,
} from "@/modules/sales/application/sales-dispatch-contracts";
import {
  initialSalesDispatchActionState,
  type SalesDispatchAction,
} from "./sales-dispatch-action-state";

type DraftAllocation = { productionLotId: string; quantity: string };
type DraftLine = {
  salesOrderLineId: string;
  cartons: string;
  loosePieces: string;
  notes: string;
  allocations: DraftAllocation[];
};
export function SalesDispatchForm({
  action,
  references,
  order,
  initial,
}: {
  action: SalesDispatchAction;
  references: SalesDispatchReferences;
  order?: {
    id: string;
    number: string;
    customerName: string;
    warehouseName: string;
    lines: readonly DispatchOrderLine[];
  } | null;
  initial?: SalesDispatchRecord;
}) {
  const [state, formAction, pending] = useActionState(action, initialSalesDispatchActionState);
  const router = useRouter();
  const [lines, setLines] = useState<DraftLine[]>(() =>
    initial
      ? initial.lines.map((line) => ({
          salesOrderLineId: line.salesOrderLineId,
          cartons: line.cartons,
          loosePieces: line.loosePieces,
          notes: line.notes ?? "",
          allocations: line.allocations.map((allocation) => ({
            productionLotId: allocation.id,
            quantity: allocation.quantity,
          })),
        }))
      : (order?.lines
          .filter((line) => new Decimal(line.remainingPieces).gt(0))
          .map((line) => ({
            salesOrderLineId: line.id,
            cartons: "0",
            loosePieces: "0",
            notes: "",
            allocations: [],
          })) ?? []),
  );
  const orderLines = useMemo(() => order?.lines ?? [], [order]);
  const update = (
    index: number,
    field: keyof Omit<DraftLine, "allocations" | "salesOrderLineId">,
    value: string,
  ) =>
    setLines((current) =>
      current.map((line, position) => (position === index ? { ...line, [field]: value } : line)),
    );
  const setAllocations = (index: number, allocations: DraftAllocation[]) =>
    setLines((current) =>
      current.map((line, position) => (position === index ? { ...line, allocations } : line)),
    );
  const totals = useMemo(
    () =>
      lines.map((line) => {
        const orderLine = orderLines.find((candidate) => candidate.id === line.salesOrderLineId);
        if (!orderLine) return "0";
        try {
          return normalizeCartonQuantity(line.cartons, line.loosePieces, orderLine.piecesPerCarton)
            .totalPieces;
        } catch {
          return "0";
        }
      }),
    [lines, orderLines],
  );
  return (
    <form action={formAction} className="space-y-5">
      {initial && <input name="id" type="hidden" value={initial.id} />}
      <input name="salesOrderId" type="hidden" value={initial?.salesOrderId ?? order?.id ?? ""} />
      <input name="linesJson" type="hidden" value={JSON.stringify(lines)} />
      {!initial && (
        <label className="block text-sm font-medium">
          Sales Order
          <select
            className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] bg-white px-3"
            defaultValue={order?.id ?? ""}
            onChange={(event) => {
              if (event.target.value)
                router.push(`/sales/dispatches/new?order=${event.target.value}`);
            }}
            required
          >
            <option value="">Select eligible sales order</option>
            {references.orders.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.number} — {candidate.customerName} ({candidate.warehouseName})
              </option>
            ))}
          </select>
        </label>
      )}
      {order ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
          <strong>{order.number}</strong> — {order.customerName}
          <span className="ml-3 text-[var(--muted)]">Warehouse: {order.warehouseName}</span>
        </div>
      ) : (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Select an approved or partially dispatched sales order to load its remaining reserved
          quantities and FEFO lots.
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Field
          label="Dispatch date"
          name="dispatchDate"
          type="date"
          defaultValue={dateValue(initial?.dispatchAt ?? new Date())}
          required
        />
        <Field
          label="Vehicle number"
          name="vehicleNumber"
          defaultValue={initial?.vehicleNumber ?? ""}
        />
        <Field label="Driver" name="driverName" defaultValue={initial?.driverName ?? ""} />
        <Field label="Driver phone" name="driverPhone" defaultValue={initial?.driverPhone ?? ""} />
        <Field label="Transporter" name="transporter" defaultValue={initial?.transporter ?? ""} />
        <Field
          label="Gate pass reference"
          name="gatePassReference"
          defaultValue={initial?.gatePassReference ?? ""}
        />
        <label className="text-sm font-medium md:col-span-2 xl:col-span-4">
          Delivery / dispatch notes
          <textarea
            className="mt-1 min-h-20 w-full rounded-lg border border-[var(--border)] px-3 py-2"
            defaultValue={initial?.notes ?? ""}
            name="notes"
          />
        </label>
      </div>
      {order && (
        <div className="space-y-4">
          {lines.map((line, index) => {
            const orderLine = orderLines.find(
              (candidate) => candidate.id === line.salesOrderLineId,
            );
            if (!orderLine) return null;
            const allocationTotal = line.allocations
              .reduce((sum, allocation) => sum.add(allocation.quantity || 0), new Decimal(0))
              .toFixed();
            return (
              <section
                className="rounded-xl border border-[var(--border)] p-4"
                key={line.salesOrderLineId}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <strong>
                      {orderLine.itemCode} — {orderLine.itemName}
                    </strong>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      Ordered {orderLine.orderedPieces} | already dispatched{" "}
                      {orderLine.dispatchedPieces} | remaining {orderLine.remainingPieces} |
                      reserved {orderLine.reservedPieces} pcs
                    </p>
                  </div>
                  <button
                    className="rounded border px-3 py-1.5 text-xs font-semibold"
                    onClick={() => setAllocations(index, suggest(orderLine, totals[index]!))}
                    type="button"
                  >
                    Suggest FEFO allocation
                  </button>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <NumberField
                    label="Cartons"
                    value={line.cartons}
                    set={(value) => update(index, "cartons", value)}
                  />
                  <NumberField
                    label="Loose pieces"
                    value={line.loosePieces}
                    set={(value) => update(index, "loosePieces", value)}
                  />
                  <div className="text-sm font-medium">
                    Canonical pieces
                    <p className="mt-1 min-h-11 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-3 font-normal">
                      {totals[index]} pcs
                    </p>
                  </div>
                </div>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[43rem] text-left text-sm">
                    <thead className="bg-[var(--surface)]">
                      <tr>
                        <th className="p-2">Production lot (FEFO)</th>
                        <th className="p-2">Expiry</th>
                        <th className="p-2">Available</th>
                        <th className="p-2">Allocate pieces</th>
                        <th className="p-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {line.allocations.map((allocation, allocationIndex) => {
                        const lot = orderLine.lots.find(
                          (candidate) => candidate.id === allocation.productionLotId,
                        );
                        return (
                          <tr className="border-t" key={allocationIndex}>
                            <td className="p-2">
                              <select
                                className="min-h-10 w-full rounded border px-2"
                                value={allocation.productionLotId}
                                onChange={(event) =>
                                  setAllocations(
                                    index,
                                    line.allocations.map((candidate, position) =>
                                      position === allocationIndex
                                        ? { ...candidate, productionLotId: event.target.value }
                                        : candidate,
                                    ),
                                  )
                                }
                              >
                                <option value="">Select lot</option>
                                {orderLine.lots.map((candidate) => (
                                  <option key={candidate.id} value={candidate.id}>
                                    {candidate.lotNumber}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="p-2">
                              {lot?.expiryDate
                                ? new Date(lot.expiryDate).toLocaleDateString()
                                : "No expiry"}
                            </td>
                            <td className="p-2">{lot?.availablePieces ?? "-"} pcs</td>
                            <td className="p-2">
                              <input
                                className="min-h-10 w-32 rounded border px-2"
                                min="0"
                                onChange={(event) =>
                                  setAllocations(
                                    index,
                                    line.allocations.map((candidate, position) =>
                                      position === allocationIndex
                                        ? { ...candidate, quantity: event.target.value }
                                        : candidate,
                                    ),
                                  )
                                }
                                step="any"
                                type="number"
                                value={allocation.quantity}
                              />
                            </td>
                            <td className="p-2">
                              <button
                                className="text-xs text-red-700"
                                onClick={() =>
                                  setAllocations(
                                    index,
                                    line.allocations.filter(
                                      (_, position) => position !== allocationIndex,
                                    ),
                                  )
                                }
                                type="button"
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                  <button
                    className="rounded border px-3 py-2 font-semibold"
                    onClick={() =>
                      setAllocations(index, [
                        ...line.allocations,
                        { productionLotId: orderLine.lots[0]?.id ?? "", quantity: "0" },
                      ])
                    }
                    type="button"
                  >
                    Add lot allocation
                  </button>
                  <span
                    className={
                      new Decimal(totals[index] ?? 0).eq(allocationTotal)
                        ? "text-emerald-700"
                        : "text-red-700"
                    }
                  >
                    Allocated {allocationTotal} / dispatch {totals[index]} pcs
                  </span>
                </div>
              </section>
            );
          })}
        </div>
      )}
      <div className="flex items-center gap-3">
        <button
          className="min-h-11 rounded-lg bg-[var(--accent)] px-5 font-semibold text-white disabled:opacity-60"
          disabled={pending || !order}
        >
          {pending ? "Saving..." : initial ? "Save draft" : "Create draft dispatch"}
        </button>
        {state.message && (
          <span className="text-sm" role="status">
            {state.message}
          </span>
        )}
      </div>
      <p className="text-xs text-[var(--muted)]">
        Lot rows are ordered by expiry. The server recalculates carton math, remaining quantities,
        lot expiry and availability, per-order-line reservations, and allocation reconciliation
        before saving or posting.
      </p>
    </form>
  );
}
function suggest(line: DispatchOrderLine, total: string): DraftAllocation[] {
  let needed = new Decimal(total || 0);
  const result: DraftAllocation[] = [];
  for (const lot of line.lots) {
    if (needed.lte(0)) break;
    const quantity = Decimal.min(needed, new Decimal(lot.availablePieces));
    if (quantity.gt(0)) {
      result.push({ productionLotId: lot.id, quantity: quantity.toFixed() });
      needed = needed.sub(quantity);
    }
  }
  return result;
}
function NumberField({
  label,
  value,
  set,
}: {
  label: string;
  value: string;
  set(value: string): void;
}) {
  return (
    <label className="text-sm font-medium">
      {label}
      <input
        className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] px-3"
        min="0"
        onChange={(event) => set(event.target.value)}
        step="any"
        type="number"
        value={value}
      />
    </label>
  );
}
function Field({
  label,
  name,
  defaultValue,
  type = "text",
  required = false,
}: {
  label: string;
  name: string;
  defaultValue: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="text-sm font-medium">
      {label}
      <input
        className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] px-3"
        defaultValue={defaultValue}
        name={name}
        required={required}
        type={type}
      />
    </label>
  );
}
function dateValue(date: Date) {
  return new Date(date).toISOString().slice(0, 10);
}
