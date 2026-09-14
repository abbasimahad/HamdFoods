"use client";

import { useActionState, useState } from "react";

import { SearchableSelect } from "@/components/ui/searchable-select";
import { SingleFlightForm } from "@/components/ui/single-flight-form";
import { initialInventoryActionState, type InventoryAction } from "./action-state";

type Source = {
  itemId: string;
  itemType: string;
  itemCode: string;
  itemName: string;
  warehouseId: string;
  warehouseCode: string;
  inventoryLotId: string | null;
  productionLotId: string | null;
  lotNumber: string;
  unitId: string;
  unitSymbol: string;
  sourceStatus: "DAMAGED" | "QUARANTINE" | "SCRAP";
  quantity: string;
};
type Line = {
  sourceIndex: number;
  quantity: string;
  action: "MOVE_TO_SCRAP" | "MOVE_TO_REPROCESS" | "WRITE_OFF";
  reason: string;
  notes: string;
};

export function WasteDispositionForm({
  action,
  sources,
  initial,
}: {
  action: InventoryAction;
  sources: readonly Source[];
  initial?: {
    id: string;
    warehouseId: string;
    dispositionDate: string;
    notes: string;
    lines: readonly {
      itemId: string;
      inventoryLotId: string | null;
      productionLotId: string | null;
      sourceStatus: Source["sourceStatus"];
      unitId: string;
      quantity: string;
      action: Line["action"];
      reason: string;
      notes: string;
    }[];
  };
}) {
  const [state, formAction, pending] = useActionState(action, initialInventoryActionState);
  const [warehouseId, setWarehouseId] = useState(
    initial?.warehouseId ?? sources[0]?.warehouseId ?? "",
  );
  const [lines, setLines] = useState<Line[]>(() =>
    initial
      ? initial.lines.map((line) => ({
          sourceIndex: sources.findIndex(
            (source) =>
              source.itemId === line.itemId &&
              source.inventoryLotId === line.inventoryLotId &&
              source.productionLotId === line.productionLotId &&
              source.sourceStatus === line.sourceStatus &&
              source.warehouseId === initial.warehouseId &&
              source.unitId === line.unitId,
          ),
          quantity: line.quantity,
          action: line.action,
          reason: line.reason,
          notes: line.notes,
        }))
      : [
          {
            sourceIndex: firstSourceIndex(sources, sources[0]?.warehouseId),
            quantity: sources[firstSourceIndex(sources, sources[0]?.warehouseId)]?.quantity ?? "",
            action: defaultAction(sources[firstSourceIndex(sources, sources[0]?.warehouseId)]),
            reason: "DAMAGED",
            notes: "",
          },
        ],
  );
  const payload = lines
    .map((line) => {
      const source = sources[line.sourceIndex];
      return source
        ? {
            itemId: source.itemId,
            inventoryLotId: source.inventoryLotId ?? undefined,
            productionLotId: source.productionLotId ?? undefined,
            sourceStatus: source.sourceStatus,
            quantity: line.quantity,
            unitId: source.unitId,
            action: line.action,
            reason: line.reason,
            notes: line.notes || undefined,
          }
        : null;
    })
    .filter(Boolean);
  return (
    <SingleFlightForm action={formAction} className="space-y-6">
      {initial && <input name="id" type="hidden" value={initial.id} />}
      <input name="lines" type="hidden" value={JSON.stringify(payload)} />
      <div className="grid gap-4 md:grid-cols-2">
        <label className="text-sm font-medium">
          Disposition date
          <input
            className="mt-1 min-h-11 w-full rounded-lg border px-3"
            defaultValue={initial?.dispositionDate ?? new Date().toISOString().slice(0, 10)}
            name="dispositionDate"
            required
            type="date"
          />
        </label>
        <SearchableSelect
          disabled={lines.length > 1}
          label="Warehouse"
          name="warehouseId"
          onValueChange={(value) => {
            const sourceIndex = firstSourceIndex(sources, value);
            setWarehouseId(value);
            setLines([
              {
                sourceIndex,
                quantity: sources[sourceIndex]?.quantity ?? "",
                action: defaultAction(sources[sourceIndex]),
                reason: "DAMAGED",
                notes: "",
              },
            ]);
          }}
          options={warehouseOptions(sources)}
          value={warehouseId}
        />
      </div>
      <section className="space-y-4" aria-labelledby="disposition-lines-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold" id="disposition-lines-heading">
            Disposition lines
          </h2>
          <button
            className="rounded-lg border px-3 py-2 text-sm font-semibold"
            onClick={() =>
              setLines((current) => [
                ...current,
                {
                  sourceIndex: -1,
                  quantity: "",
                  action: "MOVE_TO_SCRAP",
                  reason: "DAMAGED",
                  notes: "",
                },
              ])
            }
            type="button"
          >
            Add item
          </button>
        </div>
        {lines.map((line, index) => {
          const source = sources[line.sourceIndex];
          const allowed = allowedActions(source);
          return (
            <fieldset className="rounded-xl border border-[var(--border)] p-4" key={index}>
              <legend className="px-2 text-sm font-semibold">Line {index + 1}</legend>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="xl:col-span-2">
                  <SearchableSelect
                    label="Item, lot and custody"
                    name={`sourceDisplay-${index}`}
                    onValueChange={(value) => {
                      const sourceIndex = Number(value);
                      setLines((current) =>
                        current.map((entry, position) =>
                          position === index
                            ? {
                                ...entry,
                                sourceIndex,
                                quantity: sources[sourceIndex]?.quantity ?? "",
                                action: defaultAction(sources[sourceIndex]),
                              }
                            : entry,
                        ),
                      );
                    }}
                    options={sources.flatMap((option, sourceIndex) =>
                      option.warehouseId === warehouseId &&
                      !lines.some(
                        (entry, position) =>
                          position !== index && entry.sourceIndex === sourceIndex,
                      )
                        ? [
                            {
                              value: String(sourceIndex),
                              label: `${option.itemCode} / ${option.lotNumber} / ${option.sourceStatus} / ${option.quantity} ${option.unitSymbol}`,
                              keywords: `${option.itemName} ${option.lotNumber} ${option.warehouseCode}`,
                            },
                          ]
                        : [],
                    )}
                    value={String(line.sourceIndex)}
                  />
                </div>
                <label className="text-sm font-medium">
                  Quantity
                  <input
                    className="mt-1 min-h-11 w-full rounded-lg border px-3"
                    max={source?.quantity}
                    min="0"
                    onChange={(event) => update(setLines, index, "quantity", event.target.value)}
                    step="any"
                    type="number"
                    value={line.quantity}
                  />
                </label>
                <label className="text-sm font-medium">
                  Action
                  <select
                    className="mt-1 min-h-11 w-full rounded-lg border bg-white px-3"
                    onChange={(event) => update(setLines, index, "action", event.target.value)}
                    value={line.action}
                  >
                    {allowed.map((action) => (
                      <option key={action} value={action}>
                        {labelAction(action)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-medium">
                  Reason
                  <select
                    className="mt-1 min-h-11 w-full rounded-lg border bg-white px-3"
                    onChange={(event) => update(setLines, index, "reason", event.target.value)}
                    value={line.reason}
                  >
                    {[
                      "DAMAGED",
                      "EXPIRED",
                      "SPOILED",
                      "CONTAMINATED",
                      "PACKAGING_DAMAGE",
                      "PRODUCTION_LOSS",
                      "QUALITY_REJECT",
                      "HANDLING_DAMAGE",
                      "OTHER",
                    ].map((reason) => (
                      <option key={reason}>{reason}</option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-medium xl:col-span-2">
                  Line notes
                  <input
                    className="mt-1 min-h-11 w-full rounded-lg border px-3"
                    onChange={(event) => update(setLines, index, "notes", event.target.value)}
                    required={line.reason === "OTHER"}
                    value={line.notes}
                  />
                </label>
                <div className="flex items-end">
                  <button
                    className="min-h-11 rounded-lg border border-red-300 px-3 text-sm font-semibold text-red-700 disabled:opacity-50"
                    disabled={lines.length === 1}
                    onClick={() =>
                      setLines((current) => current.filter((_, position) => position !== index))
                    }
                    type="button"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </fieldset>
          );
        })}
      </section>
      <label className="block text-sm font-medium">
        Document notes
        <textarea
          className="mt-1 min-h-24 w-full rounded-lg border px-3 py-2"
          defaultValue={initial?.notes}
          maxLength={3000}
          name="notes"
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button
          className="min-h-11 rounded-lg bg-[var(--accent)] px-5 font-semibold text-white disabled:opacity-60"
          disabled={pending || !sources.length || lines.some((line) => line.sourceIndex < 0)}
        >
          {pending ? "Saving draft..." : "Save disposition draft"}
        </button>
        {state.message && (
          <p className="text-sm" role="status">
            {state.message}
          </p>
        )}
      </div>
      <p className="text-xs text-[var(--muted)]">
        Saving remains a draft. Posting rechecks exact lot/status quantity and applies only the
        selected controlled action.
      </p>
      {lines.length > 1 && (
        <p className="text-xs text-[var(--muted)]">
          Remove extra lines before changing the document warehouse.
        </p>
      )}
      {lines.some((line) => line.sourceIndex < 0) && (
        <p className="text-sm text-[var(--danger-ink)]" role="alert">
          A saved source is no longer available. Select the exact replacement custody before saving.
        </p>
      )}
    </SingleFlightForm>
  );
}

function firstSourceIndex(sources: readonly Source[], warehouseId?: string) {
  return sources.findIndex((source) => source.warehouseId === warehouseId);
}

function warehouseOptions(sources: readonly Source[]) {
  return [...new Map(sources.map((source) => [source.warehouseId, source])).values()].map(
    (source) => ({
      value: source.warehouseId,
      label: source.warehouseCode,
      keywords: source.warehouseCode,
    }),
  );
}

function defaultAction(source?: Source): Line["action"] {
  return source?.sourceStatus === "SCRAP" ? "WRITE_OFF" : "MOVE_TO_SCRAP";
}
function allowedActions(source?: Source): Line["action"][] {
  if (!source) return ["MOVE_TO_SCRAP"];
  if (source.sourceStatus === "SCRAP") return ["WRITE_OFF"];
  return source.itemType === "FINISHED_GOOD"
    ? [
        "MOVE_TO_SCRAP",
        "MOVE_TO_REPROCESS",
        ...(source.sourceStatus === "DAMAGED" ? ["WRITE_OFF" as const] : []),
      ]
    : ["MOVE_TO_SCRAP", ...(source.sourceStatus === "DAMAGED" ? ["WRITE_OFF" as const] : [])];
}
function labelAction(action: string) {
  return action === "MOVE_TO_SCRAP"
    ? "Move to scrap"
    : action === "MOVE_TO_REPROCESS"
      ? "Move to reprocess"
      : "Write off";
}
function update(
  setLines: React.Dispatch<React.SetStateAction<Line[]>>,
  index: number,
  field: keyof Line,
  value: string,
) {
  setLines((current) =>
    current.map((line, position) =>
      position === index ? ({ ...line, [field]: value } as Line) : line,
    ),
  );
}
