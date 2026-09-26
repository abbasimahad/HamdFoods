"use client";

import { useActionState, useMemo, useState } from "react";
import { todayInFactoryTimeZone } from "@/server/shared/factory-local-time";
import type {
  EligibleGoodsReceiptLineForMatch,
  EligiblePurchaseOrderLineForInvoice,
  PurchaseInvoiceRecord,
} from "@/modules/purchasing/application/purchase-invoice-contracts";
import { initialPurchasingActionState, type PurchasingAction } from "./action-state";

type DraftMatch = { goodsReceiptLineId: string; matchedQuantity: string };
type DraftLine = {
  purchaseOrderLineId: string;
  invoicedQuantity: string;
  invoicedUnitRate: string;
  taxPercent: string;
  notes: string;
  matches: DraftMatch[];
};
const emptyLine = (): DraftLine => ({
  purchaseOrderLineId: "",
  invoicedQuantity: "",
  invoicedUnitRate: "",
  taxPercent: "0",
  notes: "",
  matches: [],
});

export function PurchaseInvoiceForm({
  action,
  poLines,
  grnLines,
  initial,
}: {
  action: PurchasingAction;
  poLines: readonly EligiblePurchaseOrderLineForInvoice[];
  grnLines: readonly EligibleGoodsReceiptLineForMatch[];
  initial?: PurchaseInvoiceRecord;
}) {
  const [state, formAction, pending] = useActionState(action, initialPurchasingActionState);
  const [supplierId, setSupplierId] = useState(initial?.supplierId ?? "");
  const [lines, setLines] = useState<DraftLine[]>(
    initial?.lines.map((line) => ({
      purchaseOrderLineId: line.purchaseOrderLineId,
      invoicedQuantity: line.invoicedQuantity,
      invoicedUnitRate: line.invoicedUnitRate,
      taxPercent: line.taxPercent,
      notes: line.notes ?? "",
      matches: line.matches.map((match) => ({
        goodsReceiptLineId: match.goodsReceiptLineId,
        matchedQuantity: match.matchedQuantity,
      })),
    })) ?? [emptyLine()],
  );
  const suppliers = useMemo(() => {
    const seen = new Map<string, { id: string; code: string; name: string }>();
    for (const line of poLines)
      if (!seen.has(line.supplierId))
        seen.set(line.supplierId, {
          id: line.supplierId,
          code: line.supplierCode,
          name: line.supplierName,
        });
    return [...seen.values()];
  }, [poLines]);
  const eligiblePoLines = useMemo(
    () => (supplierId ? poLines.filter((line) => line.supplierId === supplierId) : poLines),
    [poLines, supplierId],
  );
  const update = (index: number, patch: Partial<DraftLine>) =>
    setLines((current) =>
      current.map((line, position) => (position === index ? { ...line, ...patch } : line)),
    );
  const updateMatch = (lineIndex: number, matchIndex: number, patch: Partial<DraftMatch>) =>
    setLines((current) =>
      current.map((line, position) =>
        position === lineIndex
          ? {
              ...line,
              matches: line.matches.map((match, mi) =>
                mi === matchIndex ? { ...match, ...patch } : match,
              ),
            }
          : line,
      ),
    );
  return (
    <form action={formAction} className="space-y-5">
      {initial && <input name="id" type="hidden" value={initial.id} />}
      <input name="linesJson" type="hidden" value={JSON.stringify(lines)} />
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
        <label className="text-sm font-medium">
          Supplier
          <select
            className="mt-1 min-h-11 w-full rounded-lg border bg-white px-3"
            name="supplierId"
            onChange={(event) => setSupplierId(event.target.value)}
            required
            value={supplierId}
          >
            <option value="">Select supplier</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.code} - {supplier.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium">
          Supplier invoice number
          <input
            className="mt-1 min-h-11 w-full rounded-lg border px-3"
            defaultValue={initial?.supplierInvoiceNumber ?? ""}
            maxLength={120}
            name="supplierInvoiceNumber"
            required
          />
        </label>
        <label className="text-sm font-medium">
          Invoice date
          <input
            className="mt-1 min-h-11 w-full rounded-lg border px-3"
            defaultValue={initial ? dateOnly(initial.invoiceDate) : todayInFactoryTimeZone()}
            name="invoiceDate"
            required
            type="date"
          />
        </label>
        <label className="text-sm font-medium">
          Due date <span className="text-xs text-[var(--muted)]">(informational only)</span>
          <input
            className="mt-1 min-h-11 w-full rounded-lg border px-3"
            defaultValue={initial?.dueDate ? dateOnly(initial.dueDate) : ""}
            name="dueDate"
            type="date"
          />
        </label>
        <label className="col-span-full text-sm font-medium">
          Notes
          <textarea
            className="mt-1 min-h-11 w-full rounded-lg border px-3 py-2"
            defaultValue={initial?.notes ?? ""}
            name="notes"
          />
        </label>
      </div>
      <div className="space-y-4">
        {lines.map((line, index) => {
          const poLine = poLines.find(
            (candidate) => candidate.purchaseOrderLineId === line.purchaseOrderLineId,
          );
          const eligibleMatches = grnLines.filter(
            (candidate) => candidate.purchaseOrderLineId === line.purchaseOrderLineId,
          );
          const matchedTotal = line.matches.reduce(
            (total, match) => total + (Number(match.matchedQuantity) || 0),
            0,
          );
          const invoicedQuantity = Number(line.invoicedQuantity) || 0;
          const complete = line.matches.length > 0 && matchedTotal === invoicedQuantity;
          return (
            <div className="rounded-xl border p-4" key={index}>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                <label className="text-sm font-medium xl:col-span-2">
                  Purchase order line
                  <select
                    className="mt-1 min-h-10 w-full rounded-lg border bg-white px-2"
                    onChange={(event) => {
                      const selected = eligiblePoLines.find(
                        (candidate) => candidate.purchaseOrderLineId === event.target.value,
                      );
                      update(index, {
                        purchaseOrderLineId: event.target.value,
                        invoicedUnitRate: selected?.poUnitRate ?? line.invoicedUnitRate,
                        taxPercent: selected?.poTaxPercent ?? line.taxPercent,
                        matches: [],
                      });
                    }}
                    required
                    value={line.purchaseOrderLineId}
                  >
                    <option value="">Select PO line</option>
                    {eligiblePoLines.map((candidate) => (
                      <option
                        key={candidate.purchaseOrderLineId}
                        value={candidate.purchaseOrderLineId}
                      >
                        {candidate.purchaseOrderNumber} / {candidate.itemCode} -{" "}
                        {candidate.itemName} ({candidate.orderedQuantity}{" "}
                        {candidate.canonicalUnitSymbol})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-medium">
                  Invoiced quantity
                  <input
                    className="mt-1 min-h-10 w-full rounded-lg border px-2"
                    min="0"
                    onChange={(event) => update(index, { invoicedQuantity: event.target.value })}
                    required
                    step="any"
                    type="number"
                    value={line.invoicedQuantity}
                  />
                  {poLine && (
                    <span className="mt-1 block text-xs">{poLine.canonicalUnitSymbol}</span>
                  )}
                </label>
                <label className="text-sm font-medium">
                  Invoiced rate
                  <input
                    className="mt-1 min-h-10 w-full rounded-lg border px-2"
                    min="0"
                    onChange={(event) => update(index, { invoicedUnitRate: event.target.value })}
                    required
                    step="any"
                    type="number"
                    value={line.invoicedUnitRate}
                  />
                </label>
                <label className="text-sm font-medium">
                  Tax %
                  <input
                    className="mt-1 min-h-10 w-full rounded-lg border px-2"
                    max="100"
                    min="0"
                    onChange={(event) => update(index, { taxPercent: event.target.value })}
                    step="any"
                    type="number"
                    value={line.taxPercent}
                  />
                </label>
              </div>
              <div className="mt-3 rounded-lg bg-[var(--surface)] p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                    Goods receipt matching
                  </span>
                  <span
                    className={`text-xs font-semibold ${complete ? "text-green-700" : "text-amber-700"}`}
                  >
                    Matched {matchedTotal} of {invoicedQuantity || "?"}{" "}
                    {complete ? "(complete)" : "(incomplete)"}
                  </span>
                </div>
                {line.matches.length === 0 && (
                  <p className="mt-2 text-xs text-[var(--muted)]">
                    No goods receipt matched yet -- valid as a draft, but posting requires full
                    matching.
                  </p>
                )}
                <div className="mt-2 space-y-2">
                  {line.matches.map((match, matchIndex) => {
                    const grnLine = grnLines.find(
                      (candidate) => candidate.goodsReceiptLineId === match.goodsReceiptLineId,
                    );
                    const rate = Number(line.invoicedUnitRate) || 0;
                    const cost = grnLine ? Number(grnLine.grnDerivedUnitCost) : 0;
                    const qty = Number(match.matchedQuantity) || 0;
                    const variance = (rate - cost) * qty;
                    return (
                      <div className="flex flex-wrap items-center gap-2" key={matchIndex}>
                        <select
                          className="min-h-10 w-80 rounded-lg border bg-white px-2 text-xs"
                          onChange={(event) =>
                            updateMatch(index, matchIndex, {
                              goodsReceiptLineId: event.target.value,
                            })
                          }
                          required
                          value={match.goodsReceiptLineId}
                        >
                          <option value="">Select goods receipt line</option>
                          {eligibleMatches.map((candidate) => (
                            <option
                              key={candidate.goodsReceiptLineId}
                              value={candidate.goodsReceiptLineId}
                            >
                              {candidate.goodsReceiptNumber} - remaining{" "}
                              {candidate.remainingToInvoice}
                            </option>
                          ))}
                        </select>
                        <input
                          className="min-h-10 w-28 rounded-lg border px-2"
                          min="0"
                          onChange={(event) =>
                            updateMatch(index, matchIndex, { matchedQuantity: event.target.value })
                          }
                          required
                          step="any"
                          type="number"
                          value={match.matchedQuantity}
                        />
                        {grnLine && qty > 0 && (
                          <span
                            className={`text-xs ${variance === 0 ? "text-[var(--muted)]" : variance > 0 ? "text-red-700" : "text-green-700"}`}
                          >
                            {variance === 0
                              ? "no price variance vs GRN cost"
                              : `est. variance ${variance > 0 ? "+" : ""}${variance.toFixed(2)}`}
                          </span>
                        )}
                        <button
                          className="text-xs text-red-700"
                          onClick={() =>
                            update(index, {
                              matches: line.matches.filter((_, mi) => mi !== matchIndex),
                            })
                          }
                          type="button"
                        >
                          Remove match
                        </button>
                      </div>
                    );
                  })}
                </div>
                <button
                  className="mt-2 rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
                  disabled={!line.purchaseOrderLineId || eligibleMatches.length === 0}
                  onClick={() =>
                    update(index, {
                      matches: [...line.matches, { goodsReceiptLineId: "", matchedQuantity: "" }],
                    })
                  }
                  type="button"
                >
                  Add GRN match
                </button>
              </div>
              <div className="mt-3">
                <button
                  className="text-xs text-red-700 disabled:opacity-40"
                  disabled={lines.length === 1}
                  onClick={() =>
                    setLines((current) => current.filter((_, position) => position !== index))
                  }
                  type="button"
                >
                  Remove line
                </button>
              </div>
            </div>
          );
        })}
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
          {pending ? "Saving..." : initial ? "Save draft" : "Create draft invoice"}
        </button>
        {state.message && (
          <p className="text-sm" role="status">
            {state.message}
          </p>
        )}
      </div>
      <p className="text-xs text-[var(--muted)]">
        An invoice line may be saved without a goods receipt match (pre-GRN draft). Posting requires
        every line&apos;s matched quantity to exactly equal its invoiced quantity against
        QC-completed goods receipt lines. Exact matches create no accounting entry; only price/tax
        variance from the goods receipt basis is posted as a true-up against Accounts Payable.
      </p>
    </form>
  );
}
function dateOnly(value: Date) {
  return new Date(value).toISOString().slice(0, 10);
}
