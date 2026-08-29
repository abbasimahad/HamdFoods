"use client";

import { useActionState, useMemo, useState } from "react";
import type { ValuationIssueRecord } from "@/modules/costing/application/contracts";
import type { CostingAction } from "./costing-action-state";
import { initialCostingActionState } from "./costing-action-state";

export function RebuildValuationForm({ action }: { action: CostingAction }) {
  const [state, formAction, pending] = useActionState(action, initialCostingActionState);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <button
        className="rounded-lg border border-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent)] disabled:opacity-60"
        disabled={pending}
      >
        {pending ? "Rebuilding…" : "Rebuild unvalued history"}
      </button>
      {state.message && (
        <span className="text-sm" role="status">
          {state.message}
        </span>
      )}
    </form>
  );
}

export function InitializeValuationForm({
  action,
  issue,
}: {
  action: CostingAction;
  issue: ValuationIssueRecord;
}) {
  const [state, formAction, pending] = useActionState(action, initialCostingActionState);
  return (
    <form action={formAction} className="grid gap-2 md:grid-cols-4">
      <input name="issueId" type="hidden" value={issue.id} />
      <input
        className="rounded-lg border px-3 py-2"
        inputMode="decimal"
        name="totalValue"
        placeholder="Current value to add (0 if exhausted)"
        required
      />
      <input
        className="rounded-lg border px-3 py-2"
        name="reference"
        placeholder="Reference (optional)"
      />
      <input
        className="rounded-lg border px-3 py-2"
        name="reason"
        placeholder="Initialization reason"
        required
      />
      <button
        className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
        disabled={pending}
      >
        Initialize value
      </button>
      {state.message && (
        <span className="text-sm md:col-span-4" role="status">
          {state.message}
        </span>
      )}
    </form>
  );
}

export function ValuationAdjustmentForm({
  action,
  items,
}: {
  action: CostingAction;
  items: readonly { itemId: string; itemCode: string; itemName: string }[];
}) {
  const [state, formAction, pending] = useActionState(action, initialCostingActionState);
  return (
    <form action={formAction} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <select className="rounded-lg border bg-white px-3 py-2" name="itemId" required>
        <option value="">Inventory itemâ€¦</option>
        {items.map((item) => (
          <option key={item.itemId} value={item.itemId}>
            {item.itemCode} â€” {item.itemName}
          </option>
        ))}
      </select>
      <input
        className="rounded-lg border px-3 py-2"
        inputMode="decimal"
        name="valueDelta"
        placeholder="Value increase or -decrease"
        required
      />
      <input
        className="rounded-lg border px-3 py-2"
        name="reference"
        placeholder="Reference (optional)"
      />
      <input
        className="rounded-lg border px-3 py-2"
        name="reason"
        placeholder="Correction reason"
        required
      />
      <button
        className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        disabled={pending || items.length === 0}
      >
        Post monetary adjustment
      </button>
      {state.message && (
        <span className="text-sm md:col-span-2 xl:col-span-3" role="status">
          {state.message}
        </span>
      )}
    </form>
  );
}

type Receipt = {
  id: string;
  number: string;
  supplierName: string;
  lines: readonly {
    id: string;
    itemCode: string;
    itemName: string;
    quantity: string;
    baseValue: string;
  }[];
};
export function LandedCostForm({
  action,
  receipts,
}: {
  action: CostingAction;
  receipts: readonly Receipt[];
}) {
  const [state, formAction, pending] = useActionState(action, initialCostingActionState);
  const [receiptId, setReceiptId] = useState("");
  const [manual, setManual] = useState<Record<string, string>>({});
  const receipt = useMemo(
    () => receipts.find((row) => row.id === receiptId),
    [receiptId, receipts],
  );
  const allocations =
    receipt?.lines.map((line) => ({
      goodsReceiptLineId: line.id,
      allocatedAmount: manual[line.id] ?? "0",
    })) ?? [];
  return (
    <form action={formAction} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <select
        className="rounded-lg border bg-white px-3 py-2"
        name="goodsReceiptId"
        onChange={(event) => setReceiptId(event.target.value)}
        required
        value={receiptId}
      >
        <option value="">Posted GRN…</option>
        {receipts.map((row) => (
          <option key={row.id} value={row.id}>
            {row.number} — {row.supplierName}
          </option>
        ))}
      </select>
      <select className="rounded-lg border bg-white px-3 py-2" name="allocationMethod" required>
        <option value="BY_LINE_VALUE">By line value</option>
        <option value="BY_QUANTITY">By compatible quantity</option>
        <option value="MANUAL">Manual</option>
      </select>
      <input
        className="rounded-lg border px-3 py-2"
        name="category"
        placeholder="Freight / duty / handling"
        required
      />
      <input
        className="rounded-lg border px-3 py-2"
        inputMode="decimal"
        name="totalAmount"
        placeholder="Total landed cost"
        required
      />
      <input
        className="rounded-lg border px-3 py-2"
        name="reference"
        placeholder="Reference (optional)"
      />
      <input
        className="rounded-lg border px-3 py-2 md:col-span-2"
        name="description"
        placeholder="Description"
        required
      />
      <input name="allocationsJson" type="hidden" value={JSON.stringify(allocations)} />
      {receipt && (
        <div className="space-y-2 md:col-span-2 xl:col-span-4">
          {receipt.lines.map((line) => (
            <label className="grid gap-2 text-sm md:grid-cols-[1fr_12rem]" key={line.id}>
              <span>
                {line.itemCode} — {line.itemName}; qty {line.quantity}; base value {line.baseValue}
              </span>
              <input
                className="rounded-lg border px-3 py-2"
                inputMode="decimal"
                onChange={(event) =>
                  setManual((current) => ({ ...current, [line.id]: event.target.value }))
                }
                placeholder="Manual allocation"
                value={manual[line.id] ?? ""}
              />
            </label>
          ))}
        </div>
      )}
      <button
        className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        disabled={pending || !receipt}
      >
        Post landed cost
      </button>
      {state.message && (
        <span className="text-sm md:col-span-2 xl:col-span-3" role="status">
          {state.message}
        </span>
      )}
    </form>
  );
}
