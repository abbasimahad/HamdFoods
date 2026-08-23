"use client";

import { useActionState, useMemo, useState } from "react";
import type { PurchaseCatalogUnit } from "@/modules/purchasing/application/contracts";
import {
  PURCHASE_RETURN_REASONS,
  type EligibleReturnSource,
  type PurchaseReturnRecord,
} from "@/modules/purchasing/application/return-contracts";
import { initialPurchasingActionState, type PurchasingAction } from "./action-state";

type DraftLine = {
  sourceKey: string;
  quantity: string;
  unitId: string;
  reason: string;
  replacementExpected: boolean;
  notes: string;
};
const emptyLine = (): DraftLine => ({
  sourceKey: "",
  quantity: "",
  unitId: "",
  reason: "QC_REJECTED",
  replacementExpected: false,
  notes: "",
});

export function PurchaseReturnForm({
  action,
  sources,
  units,
  initial,
}: {
  action: PurchasingAction;
  sources: readonly EligibleReturnSource[];
  units: readonly PurchaseCatalogUnit[];
  initial?: PurchaseReturnRecord;
}) {
  const [state, formAction, pending] = useActionState(action, initialPurchasingActionState);
  const [lines, setLines] = useState<DraftLine[]>(
    initial?.lines.map((line) => ({
      sourceKey: line.sourceKey,
      quantity: line.enteredQuantity,
      unitId: line.enteredUnitId,
      reason: line.reason,
      replacementExpected: line.replacementExpected,
      notes: line.notes ?? "",
    })) ?? [emptyLine()],
  );
  const first = sources.find((source) => source.key === lines[0]?.sourceKey);
  const eligible = useMemo(
    () =>
      first
        ? sources.filter(
            (source) =>
              source.supplierId === first.supplierId &&
              source.purchaseOrderId === first.purchaseOrderId &&
              source.goodsReceiptId === first.goodsReceiptId &&
              source.warehouseId === first.warehouseId,
          )
        : sources,
    [first, sources],
  );
  const update = (index: number, patch: Partial<DraftLine>) =>
    setLines((current) =>
      current.map((line, position) => (position === index ? { ...line, ...patch } : line)),
    );
  return (
    <form action={formAction} className="space-y-5">
      {initial && <input name="id" type="hidden" value={initial.id} />}
      <input name="linesJson" type="hidden" value={JSON.stringify(lines)} />
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm font-medium">
          Return date
          <input
            className="mt-1 min-h-11 w-full rounded-lg border px-3"
            defaultValue={initial ? dateOnly(initial.returnDate) : dateOnly(new Date())}
            name="returnDate"
            required
            type="date"
          />
        </label>
        <label className="text-sm font-medium">
          Supplier challan / reference
          <input
            className="mt-1 min-h-11 w-full rounded-lg border px-3"
            defaultValue={initial?.supplierReturnReference ?? ""}
            name="supplierReturnReference"
          />
        </label>
        <label className="text-sm font-medium">
          Header notes
          <textarea
            className="mt-1 min-h-11 w-full rounded-lg border px-3 py-2"
            defaultValue={initial?.reasonNotes ?? ""}
            name="reasonNotes"
          />
        </label>
      </div>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[90rem] text-left text-sm">
          <thead className="bg-[var(--surface)]">
            <tr>
              <th className="p-3">Eligible purchased lot/source</th>
              <th className="p-3">Eligible</th>
              <th className="p-3">Quantity</th>
              <th className="p-3">Unit</th>
              <th className="p-3">Reason</th>
              <th className="p-3">Replacement</th>
              <th className="p-3">Notes</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y">
            {lines.map((line, index) => {
              const source = sources.find((candidate) => candidate.key === line.sourceKey);
              const compatible = source
                ? units.filter(
                    (unit) => unit.dimension === supportedDimension(source.canonicalUnitCode),
                  )
                : [];
              return (
                <tr key={index}>
                  <td className="p-2">
                    <select
                      className="min-h-10 w-[28rem] rounded-lg border bg-white px-2"
                      onChange={(event) => {
                        const selected = sources.find(
                          (candidate) => candidate.key === event.target.value,
                        );
                        update(index, {
                          sourceKey: event.target.value,
                          unitId: "",
                          reason:
                            selected?.source === "QC_REJECTED" ? "QC_REJECTED" : "LATENT_DEFECT",
                        });
                      }}
                      required
                      value={line.sourceKey}
                    >
                      <option value="">Select source</option>
                      {eligible.map((candidate) => (
                        <option key={candidate.key} value={candidate.key}>
                          {candidate.goodsReceiptNumber} / {candidate.itemCode} / lot{" "}
                          {candidate.supplierLotNumber ?? "internal"} /{" "}
                          {candidate.source.replaceAll("_", " ")}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="p-3">
                    {source ? `${source.eligibleQuantity} ${source.canonicalUnitSymbol}` : "-"}
                  </td>
                  <td className="p-2">
                    <input
                      className="min-h-10 w-32 rounded-lg border px-2"
                      min="0"
                      onChange={(event) => update(index, { quantity: event.target.value })}
                      required
                      step="any"
                      type="number"
                      value={line.quantity}
                    />
                  </td>
                  <td className="p-2">
                    <select
                      className="min-h-10 w-28 rounded-lg border bg-white px-2"
                      onChange={(event) => update(index, { unitId: event.target.value })}
                      required
                      value={line.unitId}
                    >
                      <option value="">Unit</option>
                      {compatible.map((unit) => (
                        <option key={unit.id} value={unit.id}>
                          {unit.code}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="p-2">
                    <select
                      className="min-h-10 w-48 rounded-lg border bg-white px-2"
                      onChange={(event) => update(index, { reason: event.target.value })}
                      value={line.reason}
                    >
                      {PURCHASE_RETURN_REASONS.map((reason) => (
                        <option key={reason} value={reason}>
                          {reason.replaceAll("_", " ")}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="p-3">
                    <label className="flex items-center gap-2">
                      <input
                        checked={line.replacementExpected}
                        onChange={(event) =>
                          update(index, { replacementExpected: event.target.checked })
                        }
                        type="checkbox"
                      />
                      Expected
                    </label>
                  </td>
                  <td className="p-2">
                    <input
                      className="min-h-10 w-48 rounded-lg border px-2"
                      onChange={(event) => update(index, { notes: event.target.value })}
                      value={line.notes}
                    />
                  </td>
                  <td className="p-2">
                    <button
                      className="text-xs text-red-700 disabled:opacity-40"
                      disabled={lines.length === 1}
                      onClick={() =>
                        setLines((current) => current.filter((_, position) => position !== index))
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
      <div className="flex flex-wrap items-center gap-3">
        <button
          className="rounded-lg border px-4 py-2 text-sm font-semibold"
          onClick={() => setLines((current) => [...current, emptyLine()])}
          type="button"
        >
          Add line
        </button>
        <button
          className="min-h-11 rounded-lg bg-[var(--accent)] px-5 font-semibold text-white disabled:opacity-60"
          disabled={pending}
          type="submit"
        >
          {pending ? "Saving..." : initial ? "Save draft" : "Create draft return"}
        </button>
        {state.message && (
          <p className="text-sm" role="status">
            {state.message}
          </p>
        )}
      </div>
      <p className="text-xs text-[var(--muted)]">
        Only server-derived QC-rejected or defect-quarantined purchased lots are eligible. Posting
        removes QUARANTINE stock from factory custody.
      </p>
    </form>
  );
}
function supportedDimension(code: string): "MASS" | "VOLUME" | "COUNT" {
  return code === "G" || code === "KG"
    ? "MASS"
    : code === "ML" || code === "L"
      ? "VOLUME"
      : "COUNT";
}
function dateOnly(value: Date) {
  return new Date(value).toISOString().slice(0, 10);
}
