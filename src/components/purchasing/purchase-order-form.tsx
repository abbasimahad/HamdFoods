"use client";

import Decimal from "decimal.js";
import { useActionState, useMemo, useState } from "react";

import type {
  PurchaseCatalogItem,
  PurchaseCatalogUnit,
  PurchaseOrderRecord,
  SupplierRecord,
} from "@/modules/purchasing/application/contracts";
import { formatMoney } from "@/modules/purchasing/domain/purchasing";

import { initialPurchasingActionState, type PurchasingAction } from "./action-state";

type DraftLine = {
  itemId: string;
  quantity: string;
  unitId: string;
  unitRate: string;
  discountPercent: string;
  taxPercent: string;
  notes: string;
};
const emptyLine = (): DraftLine => ({
  itemId: "",
  quantity: "",
  unitId: "",
  unitRate: "0",
  discountPercent: "0",
  taxPercent: "0",
  notes: "",
});

export function PurchaseOrderForm({
  action,
  suppliers,
  items,
  units,
  initial,
}: {
  action: PurchasingAction;
  suppliers: readonly SupplierRecord[];
  items: readonly PurchaseCatalogItem[];
  units: readonly PurchaseCatalogUnit[];
  initial?: PurchaseOrderRecord;
}) {
  const [state, formAction, pending] = useActionState(action, initialPurchasingActionState);
  const [lines, setLines] = useState<DraftLine[]>(
    initial?.lines.map((line) => ({
      itemId: line.itemId,
      quantity: line.orderedQuantity,
      unitId: line.orderUnitId,
      unitRate: line.unitRate,
      discountPercent: line.discountPercent,
      taxPercent: line.taxPercent,
      notes: line.notes ?? "",
    })) ?? [emptyLine()],
  );
  const totals = useMemo(() => previewTotals(lines), [lines]);
  const update = (index: number, field: keyof DraftLine, value: string) =>
    setLines((current) =>
      current.map((line, position) =>
        position === index
          ? { ...line, [field]: value, ...(field === "itemId" ? { unitId: "" } : {}) }
          : line,
      ),
    );
  return (
    <form action={formAction} className="space-y-5">
      {initial && <input name="id" type="hidden" value={initial.id} />}
      <input name="linesJson" type="hidden" value={JSON.stringify(lines)} />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="text-sm font-medium">
          Supplier
          <select
            className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] bg-white px-3"
            defaultValue={initial?.supplierId ?? ""}
            name="supplierId"
            required
          >
            <option value="">Select supplier</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.code} - {supplier.name}
              </option>
            ))}
          </select>
        </label>
        <Field
          label="Order date"
          name="orderDate"
          type="date"
          defaultValue={initial ? dateValue(initial.orderDate) : dateValue(new Date())}
          required
        />
        <Field
          label="Expected delivery"
          name="expectedDeliveryDate"
          type="date"
          defaultValue={
            initial?.expectedDeliveryDate ? dateValue(initial.expectedDeliveryDate) : ""
          }
        />
        <Field
          label="Supplier quotation / reference"
          name="supplierReference"
          defaultValue={initial?.supplierReference ?? ""}
        />
        <label className="text-sm font-medium md:col-span-2 xl:col-span-4">
          Notes
          <textarea
            className="mt-1 min-h-20 w-full rounded-lg border border-[var(--border)] px-3 py-2"
            defaultValue={initial?.notes ?? ""}
            name="notes"
          />
        </label>
      </div>
      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full min-w-[78rem] text-left text-sm">
          <thead className="bg-[var(--surface)]">
            <tr>
              <th className="p-3">Item</th>
              <th className="p-3">Quantity</th>
              <th className="p-3">Order unit</th>
              <th className="p-3">Rate / unit</th>
              <th className="p-3">Discount %</th>
              <th className="p-3">Tax %</th>
              <th className="p-3">Notes</th>
              <th className="p-3">Line total</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {lines.map((line, index) => {
              const item = items.find((candidate) => candidate.id === line.itemId);
              const compatibleUnits = item
                ? units.filter((unit) => unit.dimension === item.stockUnitDimension)
                : [];
              return (
                <tr key={index}>
                  <td className="p-2">
                    <select
                      className="min-h-10 w-64 rounded-lg border border-[var(--border)] bg-white px-2"
                      value={line.itemId}
                      onChange={(event) => update(index, "itemId", event.target.value)}
                      required
                    >
                      <option value="">Select item</option>
                      {items.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.code} - {candidate.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <CellInput
                    value={line.quantity}
                    onChange={(value) => update(index, "quantity", value)}
                  />
                  <td className="p-2">
                    <select
                      className="min-h-10 w-32 rounded-lg border border-[var(--border)] bg-white px-2"
                      value={line.unitId}
                      onChange={(event) => update(index, "unitId", event.target.value)}
                      required
                    >
                      <option value="">Unit</option>
                      {compatibleUnits.map((unit) => (
                        <option key={unit.id} value={unit.id}>
                          {unit.code}
                        </option>
                      ))}
                    </select>
                  </td>
                  <CellInput
                    value={line.unitRate}
                    onChange={(value) => update(index, "unitRate", value)}
                  />
                  <CellInput
                    value={line.discountPercent}
                    onChange={(value) => update(index, "discountPercent", value)}
                  />
                  <CellInput
                    value={line.taxPercent}
                    onChange={(value) => update(index, "taxPercent", value)}
                  />
                  <CellInput
                    value={line.notes}
                    onChange={(value) => update(index, "notes", value)}
                    text
                  />
                  <td className="whitespace-nowrap p-3 font-semibold">
                    {formatMoney(linePreview(line))}
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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <button
          className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold"
          onClick={() => setLines((current) => [...current, emptyLine()])}
          type="button"
        >
          Add line
        </button>
        <dl className="grid min-w-72 grid-cols-2 gap-x-8 gap-y-2 text-sm">
          <dt>Subtotal</dt>
          <dd className="text-right">{formatMoney(totals.subtotal)}</dd>
          <dt>Discount</dt>
          <dd className="text-right">{formatMoney(totals.discount)}</dd>
          <dt>Tax</dt>
          <dd className="text-right">{formatMoney(totals.tax)}</dd>
          <dt className="font-bold">Grand total</dt>
          <dd className="text-right font-bold">{formatMoney(totals.grand)}</dd>
        </dl>
      </div>
      <div className="flex items-center gap-3">
        <button
          className="min-h-11 rounded-lg bg-[var(--accent)] px-5 font-semibold text-white disabled:opacity-60"
          disabled={pending}
          type="submit"
        >
          {pending ? "Saving..." : initial ? "Save draft" : "Create draft"}
        </button>
        {state.message && (
          <p className="text-sm" role="status">
            {state.message}
          </p>
        )}
      </div>
      <p className="text-xs text-[var(--muted)]">
        Displayed totals are a live preview. The server revalidates references, normalizes
        quantities, and recalculates all authoritative totals.
      </p>
    </form>
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
function CellInput({
  value,
  onChange,
  text = false,
}: {
  value: string;
  onChange(value: string): void;
  text?: boolean;
}) {
  return (
    <td className="p-2">
      <input
        className="min-h-10 w-28 rounded-lg border border-[var(--border)] px-2"
        min={text ? undefined : 0}
        onChange={(event) => onChange(event.target.value)}
        required={!text}
        step={text ? undefined : "any"}
        type={text ? "text" : "number"}
        value={value}
      />
    </td>
  );
}
function safeDecimal(value: string) {
  try {
    const result = new Decimal(value || 0);
    return result.isFinite() && result.gte(0) ? result : new Decimal(0);
  } catch {
    return new Decimal(0);
  }
}
function lineAmounts(line: DraftLine) {
  const gross = safeDecimal(line.quantity).mul(safeDecimal(line.unitRate));
  const discount = gross.mul(Decimal.min(safeDecimal(line.discountPercent), 100)).div(100);
  const tax = gross
    .sub(discount)
    .mul(Decimal.min(safeDecimal(line.taxPercent), 100))
    .div(100);
  return { gross, discount, tax, net: gross.sub(discount).add(tax) };
}
function linePreview(line: DraftLine) {
  return lineAmounts(line).net.toFixed(2);
}
function previewTotals(lines: readonly DraftLine[]) {
  const values = lines.map(lineAmounts);
  const sum = (key: "gross" | "discount" | "tax" | "net") =>
    values.reduce((total, line) => total.add(line[key]), new Decimal(0)).toFixed(2);
  return { subtotal: sum("gross"), discount: sum("discount"), tax: sum("tax"), grand: sum("net") };
}
function dateValue(date: Date) {
  return new Date(date).toISOString().slice(0, 10);
}
