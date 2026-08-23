"use client";
import { useActionState, useState } from "react";
import type {
  GoodsReceiptRecord,
  QcRejectionReason,
} from "@/modules/purchasing/application/receiving-contracts";
import { QC_REJECTION_REASONS } from "@/modules/purchasing/application/receiving-contracts";
import { initialPurchasingActionState, type PurchasingAction } from "./action-state";
type Decision = {
  goodsReceiptLineId: string;
  acceptedQuantity: string;
  rejectedQuantity: string;
  rejectionReason: QcRejectionReason | "";
  rejectionNotes: string;
};
export function GoodsReceiptQcForm({
  action,
  receipt,
}: {
  action: PurchasingAction;
  receipt: GoodsReceiptRecord;
}) {
  const [state, formAction, pending] = useActionState(action, initialPurchasingActionState);
  const [decisions, setDecisions] = useState<Decision[]>(
    receipt.lines.map((line) => ({
      goodsReceiptLineId: line.id,
      acceptedQuantity: line.normalizedQuantity,
      rejectedQuantity: "0",
      rejectionReason: "",
      rejectionNotes: "",
    })),
  );
  const update = (index: number, field: keyof Decision, value: string) =>
    setDecisions((current) =>
      current.map((decision, position) =>
        position === index ? ({ ...decision, [field]: value } as Decision) : decision,
      ),
    );
  return (
    <form action={formAction} className="space-y-4">
      <input name="id" type="hidden" value={receipt.id} />
      <input
        name="decisionsJson"
        type="hidden"
        value={JSON.stringify(
          decisions.map((decision) => ({
            ...decision,
            rejectionReason: decision.rejectionReason || undefined,
          })),
        )}
      />
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[70rem] text-left text-sm">
          <thead className="bg-[var(--surface)]">
            <tr>
              <th className="p-3">Item / lot</th>
              <th className="p-3">Received</th>
              <th className="p-3">Accepted</th>
              <th className="p-3">Rejected</th>
              <th className="p-3">Reason</th>
              <th className="p-3">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {receipt.lines.map((line, index) => (
              <tr key={line.id}>
                <td className="p-3">
                  <strong>{line.itemCode}</strong>
                  <span className="block text-xs">
                    Lot: {line.supplierLotNumber ?? "Not supplied"}
                  </span>
                </td>
                <td className="p-3">
                  {line.normalizedQuantity} {line.canonicalUnitSymbol}
                </td>
                <QcInput
                  value={decisions[index]!.acceptedQuantity}
                  onChange={(value) => update(index, "acceptedQuantity", value)}
                />
                <QcInput
                  value={decisions[index]!.rejectedQuantity}
                  onChange={(value) => update(index, "rejectedQuantity", value)}
                />
                <td className="p-2">
                  <select
                    className="min-h-10 w-48 rounded-lg border bg-white px-2"
                    onChange={(event) => update(index, "rejectionReason", event.target.value)}
                    value={decisions[index]!.rejectionReason}
                  >
                    <option value="">No rejection</option>
                    {QC_REJECTION_REASONS.map((reason) => (
                      <option key={reason} value={reason}>
                        {reason.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="p-2">
                  <input
                    className="min-h-10 w-52 rounded-lg border px-2"
                    onChange={(event) => update(index, "rejectionNotes", event.target.value)}
                    value={decisions[index]!.rejectionNotes}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        className="min-h-11 rounded-lg bg-[var(--accent)] px-5 font-semibold text-white disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Completing QC..." : "Complete QC"}
      </button>
      {state.message && (
        <p className="text-sm" role="status">
          {state.message}
        </p>
      )}
      <p className="text-xs text-[var(--muted)]">
        Every line must reconcile exactly. Accepted stock moves to AVAILABLE; rejected stock moves
        to QUARANTINE.
      </p>
    </form>
  );
}
function QcInput({ value, onChange }: { value: string; onChange(value: string): void }) {
  return (
    <td className="p-2">
      <input
        className="min-h-10 w-36 rounded-lg border px-2"
        min="0"
        onChange={(event) => onChange(event.target.value)}
        required
        step="any"
        type="number"
        value={value}
      />
    </td>
  );
}
