"use client";

import { useActionState, useMemo, useState } from "react";
import type {
  GoodsReceiptRecord,
  ReceivablePurchaseOrder,
  ReceivingWarehouseOption,
} from "@/modules/purchasing/application/receiving-contracts";
import type { PurchaseCatalogUnit } from "@/modules/purchasing/application/contracts";
import type { ReplacementTarget } from "@/modules/purchasing/application/return-contracts";
import { initialPurchasingActionState, type PurchasingAction } from "./action-state";

type DraftLine = {
  purchaseOrderLineId: string;
  quantity: string;
  unitId: string;
  supplierLotNumber: string;
  manufacturingDate: string;
  expiryDate: string;
  notes: string;
  purchaseReturnLineId: string;
};
const emptyLine = (): DraftLine => ({
  purchaseOrderLineId: "",
  quantity: "",
  unitId: "",
  supplierLotNumber: "",
  manufacturingDate: "",
  expiryDate: "",
  notes: "",
  purchaseReturnLineId: "",
});

export function GoodsReceiptForm({
  action,
  orders,
  warehouses,
  units,
  replacementTargets,
  initial,
}: {
  action: PurchasingAction;
  orders: readonly ReceivablePurchaseOrder[];
  warehouses: readonly ReceivingWarehouseOption[];
  units: readonly PurchaseCatalogUnit[];
  replacementTargets: readonly ReplacementTarget[];
  initial?: GoodsReceiptRecord;
}) {
  const [state, formAction, pending] = useActionState(action, initialPurchasingActionState);
  const [purchaseOrderId, setPurchaseOrderId] = useState(
    initial?.purchaseOrderId ?? orders[0]?.id ?? "",
  );
  const [lines, setLines] = useState<DraftLine[]>(
    initial?.lines.map((line) => ({
      purchaseOrderLineId: line.purchaseOrderLineId,
      quantity: line.enteredQuantity,
      unitId: line.enteredUnitId,
      supplierLotNumber: line.supplierLotNumber ?? "",
      manufacturingDate: dateOnly(line.manufacturingDate),
      expiryDate: dateOnly(line.expiryDate),
      notes: line.notes ?? "",
      purchaseReturnLineId: line.purchaseReturnLineId ?? "",
    })) ?? [emptyLine()],
  );
  const [purpose, setPurpose] = useState<"PURCHASE" | "SUPPLIER_REPLACEMENT">(
    initial?.purpose ?? "PURCHASE",
  );
  const [purchaseReturnId, setPurchaseReturnId] = useState(
    initial?.purchaseReturnId ?? replacementTargets[0]?.purchaseReturnId ?? "",
  );
  const replacementTarget = replacementTargets.find(
    (candidate) => candidate.purchaseReturnId === purchaseReturnId,
  );
  const order = useMemo(
    () => orders.find((candidate) => candidate.id === purchaseOrderId),
    [orders, purchaseOrderId],
  );
  const update = (index: number, field: keyof DraftLine, value: string) =>
    setLines((current) =>
      current.map((line, position) =>
        position === index
          ? { ...line, [field]: value, ...(field === "purchaseOrderLineId" ? { unitId: "" } : {}) }
          : line,
      ),
    );
  return (
    <form action={formAction} className="space-y-5">
      {initial && <input name="id" type="hidden" value={initial.id} />}
      <input name="linesJson" type="hidden" value={JSON.stringify(lines)} />
      <input name="purpose" type="hidden" value={purpose} />
      {purpose === "SUPPLIER_REPLACEMENT" && (
        <>
          <input name="purchaseReturnId" type="hidden" value={purchaseReturnId} />
          <input
            name="purchaseOrderId"
            type="hidden"
            value={replacementTarget?.purchaseOrderId ?? initial?.purchaseOrderId ?? ""}
          />
        </>
      )}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="text-sm font-medium">
          Receipt purpose
          <select
            className="mt-1 min-h-11 w-full rounded-lg border bg-white px-3"
            disabled={Boolean(initial)}
            onChange={(event) => {
              setPurpose(event.target.value as "PURCHASE" | "SUPPLIER_REPLACEMENT");
              setLines([emptyLine()]);
            }}
            value={purpose}
          >
            <option value="PURCHASE">Normal PO supply</option>
            <option value="SUPPLIER_REPLACEMENT">Free supplier replacement</option>
          </select>
        </label>
        {purpose === "PURCHASE" ? (
          <label className="text-sm font-medium">
            Purchase order
            <select
              className="mt-1 min-h-11 w-full rounded-lg border bg-white px-3"
              disabled={Boolean(initial)}
              name="purchaseOrderId"
              onChange={(event) => {
                setPurchaseOrderId(event.target.value);
                setLines([emptyLine()]);
              }}
              required
              value={purchaseOrderId}
            >
              <option value="">Select approved PO</option>
              {orders.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.number} - {candidate.supplierName}
                </option>
              ))}
            </select>
            {initial && <input name="purchaseOrderId" type="hidden" value={purchaseOrderId} />}
          </label>
        ) : (
          <label className="text-sm font-medium">
            Purchase return obligation
            <select
              className="mt-1 min-h-11 w-full rounded-lg border bg-white px-3"
              disabled={Boolean(initial)}
              onChange={(event) => {
                setPurchaseReturnId(event.target.value);
                setLines([emptyLine()]);
              }}
              required
              value={purchaseReturnId}
            >
              <option value="">Select awaiting return</option>
              {replacementTargets.map((target) => (
                <option key={target.purchaseReturnId} value={target.purchaseReturnId}>
                  {target.purchaseReturnNumber} - {target.purchaseOrderNumber} -{" "}
                  {target.supplierName}
                </option>
              ))}
            </select>
          </label>
        )}
        <Info
          label="Supplier"
          value={
            purpose === "PURCHASE"
              ? order
                ? `${order.supplierCode} - ${order.supplierName}`
                : "Select a PO"
              : (replacementTarget?.supplierName ?? "Select a return")
          }
        />
        <Field
          label="Receipt date/time"
          name="receiptDate"
          type="datetime-local"
          required
          defaultValue={initial ? dateTimeLocal(initial.receiptDate) : dateTimeLocal(new Date())}
        />
        <label className="text-sm font-medium">
          Warehouse
          <select
            className="mt-1 min-h-11 w-full rounded-lg border bg-white px-3"
            defaultValue={initial?.warehouseId ?? ""}
            name="warehouseId"
            required
          >
            <option value="">Select warehouse</option>
            {warehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.code} - {warehouse.name}
              </option>
            ))}
          </select>
        </label>
        <Field
          label="Supplier delivery / challan"
          name="supplierDeliveryNumber"
          defaultValue={initial?.supplierDeliveryNumber ?? ""}
        />
        <Field
          label="Vehicle / reference"
          name="vehicleReference"
          defaultValue={initial?.vehicleReference ?? ""}
        />
        <label className="text-sm font-medium md:col-span-2">
          Notes
          <textarea
            className="mt-1 min-h-20 w-full rounded-lg border px-3 py-2"
            defaultValue={initial?.notes ?? ""}
            name="notes"
          />
        </label>
      </div>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[85rem] text-left text-sm">
          <thead className="bg-[var(--surface)]">
            <tr>
              <th className="p-3">PO line</th>
              <th className="p-3">Open now</th>
              <th className="p-3">Received</th>
              <th className="p-3">Unit</th>
              <th className="p-3">Supplier lot</th>
              <th className="p-3">Manufactured</th>
              <th className="p-3">Expiry</th>
              <th className="p-3">Notes</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y">
            {lines.map((line, index) => {
              const replacementLine = replacementTarget?.lines.find(
                (candidate) => candidate.purchaseReturnLineId === line.purchaseReturnLineId,
              );
              const poLine =
                purpose === "PURCHASE"
                  ? order?.lines.find((candidate) => candidate.id === line.purchaseOrderLineId)
                  : replacementLine;
              const compatible = poLine
                ? units.filter((unit) => unit.dimension === poLine.canonicalUnitDimension)
                : [];
              return (
                <tr key={index}>
                  <td className="p-2">
                    <select
                      className="min-h-10 w-72 rounded-lg border bg-white px-2"
                      onChange={(event) => {
                        if (purpose === "PURCHASE")
                          update(index, "purchaseOrderLineId", event.target.value);
                        else {
                          const selected = replacementTarget?.lines.find(
                            (candidate) => candidate.purchaseReturnLineId === event.target.value,
                          );
                          setLines((current) =>
                            current.map((candidate, position) =>
                              position === index
                                ? {
                                    ...candidate,
                                    purchaseReturnLineId: event.target.value,
                                    purchaseOrderLineId: selected?.purchaseOrderLineId ?? "",
                                    unitId: "",
                                  }
                                : candidate,
                            ),
                          );
                        }
                      }}
                      required
                      value={
                        purpose === "PURCHASE"
                          ? line.purchaseOrderLineId
                          : line.purchaseReturnLineId
                      }
                    >
                      <option value="">Select PO line</option>
                      {purpose === "PURCHASE"
                        ? order?.lines.map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>
                              {candidate.itemCode} - {candidate.itemName}
                            </option>
                          ))
                        : replacementTarget?.lines.map((candidate) => (
                            <option
                              key={candidate.purchaseReturnLineId}
                              value={candidate.purchaseReturnLineId}
                            >
                              {candidate.itemCode} - {candidate.itemName}
                            </option>
                          ))}
                    </select>
                  </td>
                  <td className="p-3">
                    {purpose === "PURCHASE" && poLine && "remainingToReceive" in poLine
                      ? `${poLine.remainingToReceive} ${poLine.canonicalUnitSymbol}`
                      : purpose === "SUPPLIER_REPLACEMENT" &&
                          poLine &&
                          "remainingQuantity" in poLine
                        ? `${poLine.remainingQuantity} ${poLine.canonicalUnitSymbol}`
                        : "-"}
                  </td>
                  <Cell
                    value={line.quantity}
                    onChange={(value) => update(index, "quantity", value)}
                    type="number"
                    required
                  />
                  <td className="p-2">
                    <select
                      className="min-h-10 w-28 rounded-lg border bg-white px-2"
                      onChange={(event) => update(index, "unitId", event.target.value)}
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
                  <Cell
                    value={line.supplierLotNumber}
                    onChange={(value) => update(index, "supplierLotNumber", value)}
                  />
                  <Cell
                    value={line.manufacturingDate}
                    onChange={(value) => update(index, "manufacturingDate", value)}
                    type="date"
                  />
                  <Cell
                    value={line.expiryDate}
                    onChange={(value) => update(index, "expiryDate", value)}
                    type="date"
                  />
                  <Cell value={line.notes} onChange={(value) => update(index, "notes", value)} />
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
          {pending ? "Saving..." : initial ? "Save draft" : "Create draft GRN"}
        </button>
        {state.message && (
          <p className="text-sm" role="status">
            {state.message}
          </p>
        )}
      </div>
      <p className="text-xs text-[var(--muted)]">
        Drafts do not affect stock. Posting revalidates the open PO quantity and creates canonical
        QUALITY_HOLD inventory.
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
        className="mt-1 min-h-11 w-full rounded-lg border px-3"
        defaultValue={defaultValue}
        name={name}
        required={required}
        type={type}
      />
    </label>
  );
}
function Cell({
  value,
  onChange,
  type = "text",
  required = false,
}: {
  value: string;
  onChange(value: string): void;
  type?: string;
  required?: boolean;
}) {
  return (
    <td className="p-2">
      <input
        className="min-h-10 w-36 rounded-lg border px-2"
        min={type === "number" ? 0 : undefined}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        step={type === "number" ? "any" : undefined}
        type={type}
        value={value}
      />
    </td>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-sm font-medium">{label}</span>
      <p className="mt-2 text-sm">{value}</p>
    </div>
  );
}
function dateOnly(value: Date | null) {
  return value ? new Date(value).toISOString().slice(0, 10) : "";
}
function dateTimeLocal(value: Date) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
