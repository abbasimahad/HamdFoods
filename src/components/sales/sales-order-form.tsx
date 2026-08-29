"use client";

import { useActionState, useMemo, useState } from "react";
import {
  calculateSalesOrderLine,
  calculateSalesOrderTotals,
  formatSalesMoney,
} from "@/modules/sales/domain/sales-orders";
import type {
  SalesOrderInput,
  SalesOrderRecord,
  SalesOrderReferences,
} from "@/modules/sales/application/sales-order-contracts";
import { initialSalesOrderActionState, type SalesOrderAction } from "./sales-order-action-state";

type DraftLine = Omit<SalesOrderInput["lines"][number], "notes"> & { notes: string };
const blank = (): DraftLine => ({
  itemId: "",
  cartons: "0",
  loosePieces: "0",
  cartonRate: "0",
  discount1Percent: "0",
  discount2Percent: "0",
  taxPercent: "0",
  notes: "",
});

export function SalesOrderForm({
  action,
  references,
  initial,
}: {
  action: SalesOrderAction;
  references: SalesOrderReferences;
  initial?: SalesOrderRecord;
}) {
  const [state, formAction, pending] = useActionState(action, initialSalesOrderActionState);
  const [customerId, setCustomerId] = useState(initial?.customerId ?? "");
  const [lines, setLines] = useState<DraftLine[]>(
    initial?.lines.map((line) => ({
      itemId: line.itemId,
      cartons: line.cartons,
      loosePieces: line.loosePieces,
      cartonRate: line.cartonRate,
      discount1Percent: line.discount1Percent,
      discount2Percent: line.discount2Percent,
      taxPercent: line.taxPercent,
      notes: line.notes ?? "",
    })) ?? [blank()],
  );
  const customer = references.customers.find((candidate) => candidate.id === customerId);
  const calculated = useMemo(
    () => lines.map((line) => preview(line, references)),
    [lines, references],
  );
  const totals = useMemo(
    () =>
      calculateSalesOrderTotals(
        calculated.filter((line): line is NonNullable<typeof line> => line !== null),
      ),
    [calculated],
  );
  const update = (index: number, field: keyof DraftLine, value: string) =>
    setLines((current) =>
      current.map((line, position) => (position === index ? { ...line, [field]: value } : line)),
    );
  return (
    <form action={formAction} className="space-y-5">
      {initial && <input name="id" type="hidden" value={initial.id} />}
      <input name="linesJson" type="hidden" value={JSON.stringify(lines)} />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="text-sm font-medium">
          Customer
          <select
            className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] bg-white px-3"
            defaultValue={customerId}
            name="customerId"
            onChange={(event) => setCustomerId(event.target.value)}
            required
          >
            <option value="">Select customer</option>
            {references.customers.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.code} - {candidate.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium">
          Sales warehouse
          <select
            className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] bg-white px-3"
            defaultValue={initial?.warehouseId ?? ""}
            name="warehouseId"
            required
          >
            <option value="">Select warehouse</option>
            {references.warehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.code} - {warehouse.name}
              </option>
            ))}
          </select>
        </label>
        <Field
          label="Order date"
          name="orderDate"
          type="date"
          defaultValue={dateValue(initial?.orderDate ?? new Date())}
          required
        />
        <Field
          label="Delivery date"
          name="deliveryDate"
          type="date"
          defaultValue={initial?.deliveryDate ? dateValue(initial.deliveryDate) : ""}
        />
        <Field
          label="Customer reference"
          name="customerReference"
          defaultValue={initial?.customerReference ?? ""}
        />
        <ReadOnly
          label="Salesperson"
          value={initial?.salespersonName ?? customer?.salespersonName ?? "Not assigned"}
        />
        <ReadOnly
          label="Area / route"
          value={
            [initial?.areaName ?? customer?.areaName, initial?.routeName ?? customer?.routeName]
              .filter(Boolean)
              .join(" / ") || "-"
          }
        />
        <ReadOnly
          label="Credit / terms"
          value={`${initial?.customerCreditLimit ?? customer?.creditLimit ?? "No credit limit"} / ${initial?.paymentTermsDays ?? customer?.paymentTermsDays ?? "-"} days`}
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
              <th className="p-3">Finished good</th>
              <th className="p-3">Cartons</th>
              <th className="p-3">Loose</th>
              <th className="p-3">Carton rate</th>
              <th className="p-3">Piece rate</th>
              <th className="p-3">D1 %</th>
              <th className="p-3">D2 %</th>
              <th className="p-3">Tax %</th>
              <th className="p-3">Line total</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {lines.map((line, index) => {
              const item = references.items.find((candidate) => candidate.id === line.itemId);
              const value = calculated[index];
              return (
                <tr key={index}>
                  <td className="p-2">
                    <select
                      className="min-h-10 w-64 rounded-lg border border-[var(--border)] bg-white px-2"
                      value={line.itemId}
                      onChange={(event) => update(index, "itemId", event.target.value)}
                      required
                    >
                      <option value="">Select finished good</option>
                      {references.items.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.code} - {candidate.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <Cell value={line.cartons} set={(value) => update(index, "cartons", value)} />
                  <Cell
                    value={line.loosePieces}
                    set={(value) => update(index, "loosePieces", value)}
                  />
                  <Cell
                    value={line.cartonRate}
                    set={(value) => update(index, "cartonRate", value)}
                  />
                  <td className="p-3">{value ? formatSalesMoney(value.pieceRate) : "-"}</td>
                  <Cell
                    value={line.discount1Percent}
                    set={(value) => update(index, "discount1Percent", value)}
                  />
                  <Cell
                    value={line.discount2Percent}
                    set={(value) => update(index, "discount2Percent", value)}
                  />
                  <Cell
                    value={line.taxPercent}
                    set={(value) => update(index, "taxPercent", value)}
                  />
                  <td className="p-3 font-semibold">
                    {value ? formatSalesMoney(value.netAmount) : "-"}
                    <span className="block text-xs text-[var(--muted)]">
                      {value ? `${value.totalPieces} pcs` : item ? "Enter valid quantities" : ""}
                    </span>
                  </td>
                  <td className="p-2">
                    <button
                      className="text-xs text-red-700"
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
      <div className="flex flex-col gap-4 sm:flex-row sm:justify-between">
        <button
          className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold"
          onClick={() => setLines((current) => [...current, blank()])}
          type="button"
        >
          Add line
        </button>
        <dl className="grid min-w-72 grid-cols-2 gap-x-8 gap-y-2 text-sm">
          <dt>Subtotal</dt>
          <dd className="text-right">{formatSalesMoney(totals.subtotal)}</dd>
          <dt>Discount</dt>
          <dd className="text-right">{formatSalesMoney(totals.discountTotal)}</dd>
          <dt>Tax</dt>
          <dd className="text-right">{formatSalesMoney(totals.taxTotal)}</dd>
          <dt className="font-bold">Grand total</dt>
          <dd className="text-right font-bold">{formatSalesMoney(totals.grandTotal)}</dd>
        </dl>
      </div>
      <div className="flex items-center gap-3">
        <button
          className="min-h-11 rounded-lg bg-[var(--accent)] px-5 font-semibold text-white disabled:opacity-60"
          disabled={pending}
        >
          {pending ? "Saving..." : initial ? "Save draft" : "Create draft"}
        </button>
        {state.message && (
          <span className="text-sm" role="status">
            {state.message}
          </span>
        )}
      </div>
      <p className="text-xs text-[var(--muted)]">
        Carton, piece-rate, sequential-discount, tax, and total previews use the shared domain
        calculation. Availability is recalculated from AVAILABLE ledger stock before approval.
      </p>
    </form>
  );
}
function preview(line: DraftLine, references: SalesOrderReferences) {
  const item = references.items.find((candidate) => candidate.id === line.itemId);
  if (!item) return null;
  try {
    return calculateSalesOrderLine({ ...line, piecesPerCarton: item.piecesPerCarton });
  } catch {
    return null;
  }
}
function Cell({ value, set }: { value: string; set(value: string): void }) {
  return (
    <td className="p-2">
      <input
        className="min-h-10 w-24 rounded-lg border border-[var(--border)] px-2"
        min="0"
        onChange={(event) => set(event.target.value)}
        step="any"
        type="number"
        value={value}
      />
    </td>
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
function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-sm font-medium">
      {label}
      <p className="mt-1 min-h-11 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-3 font-normal">
        {value}
      </p>
    </div>
  );
}
function dateValue(date: Date) {
  return new Date(date).toISOString().slice(0, 10);
}
