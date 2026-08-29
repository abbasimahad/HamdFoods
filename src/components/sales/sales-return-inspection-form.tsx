"use client";
import { useActionState, useMemo, useState } from "react";
import type { SalesReturnRecord } from "@/modules/sales/application/sales-return-contracts";
type State = { ok: boolean; message: string };
type Action = (state: State, form: FormData) => Promise<State>;
const classifications = ["GOOD_RESALE", "QUARANTINE", "REPROCESS", "DAMAGED", "EXPIRED"] as const;
export function SalesReturnInspectionForm({
  salesReturn,
  action,
}: {
  salesReturn: SalesReturnRecord;
  action: Action;
}) {
  const [state, formAction, pending] = useActionState(action, { ok: false, message: "" });
  const [quantities, setQuantities] = useState(() =>
    Object.fromEntries(
      salesReturn.lines.flatMap((line) =>
        classifications.map((classification) => [`${line.id}:${classification}`, "0"]),
      ),
    ),
  );
  const inspections = useMemo(
    () =>
      salesReturn.lines.flatMap((line) =>
        classifications
          .map((classification) => ({
            salesReturnLineId: line.id,
            classification,
            quantity: quantities[`${line.id}:${classification}`] ?? "0",
            reason: classification === "DAMAGED" ? line.reason : undefined,
          }))
          .filter((entry) => Number(entry.quantity) > 0),
      ),
    [quantities, salesReturn.lines],
  );
  return (
    <form action={formAction} className="space-y-4">
      <input name="id" type="hidden" value={salesReturn.id} />
      <input name="inspectionsJson" type="hidden" value={JSON.stringify(inspections)} />
      {salesReturn.lines.map((line) => {
        const classified = classifications.reduce(
          (sum, classification) => sum + Number(quantities[`${line.id}:${classification}`] ?? 0),
          0,
        );
        return (
          <section className="rounded-lg border p-4" key={line.id}>
            <div className="mb-3 text-sm">
              <strong>
                {line.itemCode} — Lot {line.lotNumber}
              </strong>
              <span className="ml-3">
                Returned: {line.totalPieces} pcs · Unclassified:{" "}
                {Number(line.totalPieces) - classified} pcs
              </span>
            </div>
            <div className="grid gap-3 md:grid-cols-5">
              {classifications.map((classification) => (
                <label className="text-xs font-medium" key={classification}>
                  {classification}
                  <input
                    className="mt-1 min-h-10 w-full rounded border p-2"
                    min="0"
                    step="1"
                    type="number"
                    value={quantities[`${line.id}:${classification}`] ?? "0"}
                    onChange={(event) =>
                      setQuantities((current) => ({
                        ...current,
                        [`${line.id}:${classification}`]: event.target.value,
                      }))
                    }
                  />
                </label>
              ))}
            </div>
          </section>
        );
      })}
      <button
        className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Completing..." : "Complete inspection"}
      </button>
      {state.message && (
        <p className={state.ok ? "text-sm text-green-700" : "text-sm text-red-700"}>
          {state.message}
        </p>
      )}
    </form>
  );
}
