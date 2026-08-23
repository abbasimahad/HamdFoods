"use client";

import { useActionState, useState } from "react";
import type { PurchaseCatalogUnit } from "@/modules/purchasing/application/contracts";
import {
  PURCHASE_RETURN_REASONS,
  type PurchasedLotOption,
} from "@/modules/purchasing/application/return-contracts";
import { initialPurchasingActionState, type PurchasingAction } from "./action-state";

export function PurchasedMaterialQuarantineForm({
  action,
  lots,
  units,
}: {
  action: PurchasingAction;
  lots: readonly PurchasedLotOption[];
  units: readonly PurchaseCatalogUnit[];
}) {
  const [state, formAction, pending] = useActionState(action, initialPurchasingActionState);
  const [lotId, setLotId] = useState("");
  const lot = lots.find((candidate) => candidate.inventoryLotId === lotId);
  const compatible = lot
    ? units.filter((unit) => unit.dimension === dimension(lot.canonicalUnitCode))
    : [];
  return (
    <form action={formAction} className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <input name="warehouseId" type="hidden" value={lot?.warehouseId ?? ""} />
      <label className="text-sm font-medium md:col-span-2">
        Purchased lot with AVAILABLE stock
        <select
          className="mt-1 min-h-11 w-full rounded-lg border bg-white px-3"
          name="inventoryLotId"
          onChange={(event) => setLotId(event.target.value)}
          required
          value={lotId}
        >
          <option value="">Select purchased lot</option>
          {lots.map((candidate) => (
            <option
              key={`${candidate.inventoryLotId}:${candidate.warehouseId}`}
              value={candidate.inventoryLotId}
            >
              {candidate.goodsReceiptNumber} / {candidate.purchaseOrderNumber} /{" "}
              {candidate.itemCode} / lot {candidate.supplierLotNumber ?? "internal"} /{" "}
              {candidate.warehouseName} / {candidate.availableQuantity}{" "}
              {candidate.canonicalUnitSymbol}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm font-medium">
        Quantity
        <input
          className="mt-1 min-h-11 w-full rounded-lg border px-3"
          min="0"
          name="quantity"
          required
          step="any"
          type="number"
        />
      </label>
      <label className="text-sm font-medium">
        Unit
        <select
          className="mt-1 min-h-11 w-full rounded-lg border bg-white px-3"
          name="unitId"
          required
        >
          <option value="">Select unit</option>
          {compatible.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unit.code}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm font-medium">
        Defect reason
        <select
          className="mt-1 min-h-11 w-full rounded-lg border bg-white px-3"
          name="reason"
          required
        >
          {PURCHASE_RETURN_REASONS.filter((reason) => reason !== "QC_REJECTED").map((reason) => (
            <option key={reason} value={reason}>
              {reason.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm font-medium md:col-span-2">
        Notes
        <textarea className="mt-1 min-h-20 w-full rounded-lg border px-3 py-2" name="notes" />
      </label>
      <div className="flex items-center gap-3">
        <button
          className="min-h-11 rounded-lg bg-[var(--accent)] px-5 font-semibold text-white disabled:opacity-60"
          disabled={pending}
          type="submit"
        >
          {pending ? "Moving..." : "Send to quarantine"}
        </button>
        {state.message && (
          <p className="text-sm" role="status">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
function dimension(code: string): "MASS" | "VOLUME" | "COUNT" {
  return code === "G" || code === "KG"
    ? "MASS"
    : code === "ML" || code === "L"
      ? "VOLUME"
      : "COUNT";
}
