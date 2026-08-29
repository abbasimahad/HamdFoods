"use client";
import { useActionState } from "react";
import type { SalesMasterRecord } from "@/modules/sales/application/contracts";
import { initialSalesActionState, type SalesAction } from "./action-state";
export function SalesMasterForm({
  action,
  initial,
  areas,
  kind,
}: {
  action: SalesAction;
  initial?: (SalesMasterRecord & { areaId?: string }) | undefined;
  areas?: readonly SalesMasterRecord[];
  kind: "group" | "area" | "route";
}) {
  const [state, formAction, pending] = useActionState(action, initialSalesActionState);
  const label = kind === "group" ? "Customer group" : kind === "area" ? "Area" : "Route";
  return (
    <form action={formAction} className="grid gap-3 md:grid-cols-2">
      {initial && <input name="id" type="hidden" value={initial.id} />}
      <Field name="code" label={`${label} code`} defaultValue={initial?.code} required />
      <Field name="name" label={`${label} name`} defaultValue={initial?.name} required />
      {kind === "route" && (
        <label className="text-sm font-medium">
          Area
          <select
            className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] px-3"
            defaultValue={initial?.areaId ?? ""}
            name="areaId"
            required
          >
            <option value="">Select area</option>
            {areas?.map((area) => (
              <option key={area.id} value={area.id}>
                {area.code} — {area.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="text-sm font-medium md:col-span-2">
        Description
        <textarea
          className="mt-1 min-h-20 w-full rounded-lg border border-[var(--border)] px-3 py-2"
          defaultValue={initial?.description ?? ""}
          name="description"
        />
      </label>
      <div className="md:col-span-2">
        <button
          className="min-h-11 rounded-lg bg-[var(--accent)] px-4 font-semibold text-white disabled:opacity-60"
          disabled={pending}
          type="submit"
        >
          {pending
            ? "Saving..."
            : initial
              ? `Save ${label.toLowerCase()}`
              : `Create ${label.toLowerCase()}`}
        </button>
        {state.message && (
          <span className="ml-3 text-sm" role="status">
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}
function Field({
  name,
  label,
  defaultValue,
  required = false,
}: {
  name: string;
  label: string;
  defaultValue: string | undefined;
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
      />
    </label>
  );
}
