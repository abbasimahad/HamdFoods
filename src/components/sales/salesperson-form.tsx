"use client";

import { useActionState } from "react";
import type { SalesReferenceData, SalespersonRecord } from "@/modules/sales/application/contracts";
import { initialSalesActionState, type SalesAction } from "./action-state";

export function SalespersonForm({
  action,
  initial,
  references,
}: {
  action: SalesAction;
  initial?: SalespersonRecord | undefined;
  references: SalesReferenceData;
}) {
  const [state, formAction, pending] = useActionState(action, initialSalesActionState);
  return (
    <form action={formAction} className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {initial && <input name="id" type="hidden" value={initial.id} />}
      <Field name="code" label="Salesperson code" defaultValue={initial?.code ?? ""} required />
      <Field name="name" label="Name" defaultValue={initial?.name ?? ""} required />
      <Field name="phone" label="Phone" defaultValue={initial?.phone ?? ""} />
      <Field name="email" label="Email" type="email" defaultValue={initial?.email ?? ""} />
      <label className="text-sm font-medium">
        Linked ERP user
        <select
          className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] px-3"
          defaultValue={initial?.linkedUserId ?? ""}
          name="linkedUserId"
        >
          <option value="">No linked user</option>
          {references.users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name} ({user.email})
            </option>
          ))}
        </select>
      </label>
      <fieldset className="rounded-lg border border-[var(--border)] p-3">
        <legend className="px-1 text-sm font-medium">Assigned areas</legend>
        <div className="grid gap-1">
          {references.areas.map((area) => (
            <label className="text-sm" key={area.id}>
              <input
                className="mr-2"
                defaultChecked={initial?.areaIds.includes(area.id)}
                name="areaIds"
                type="checkbox"
                value={area.id}
              />
              {area.code} — {area.name}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="rounded-lg border border-[var(--border)] p-3 md:col-span-2">
        <legend className="px-1 text-sm font-medium">Assigned routes</legend>
        <div className="grid gap-1 md:grid-cols-2">
          {references.routes.map((route) => (
            <label className="text-sm" key={route.id}>
              <input
                className="mr-2"
                defaultChecked={initial?.routeIds.includes(route.id)}
                name="routeIds"
                type="checkbox"
                value={route.id}
              />
              {route.name} <span className="text-[var(--muted)]">({route.areaName})</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="text-sm font-medium md:col-span-2 xl:col-span-3">
        Notes
        <textarea
          className="mt-1 min-h-20 w-full rounded-lg border border-[var(--border)] px-3 py-2"
          defaultValue={initial?.notes ?? ""}
          name="notes"
        />
      </label>
      <div className="md:col-span-2 xl:col-span-3">
        <button
          className="min-h-11 rounded-lg bg-[var(--accent)] px-4 font-semibold text-white disabled:opacity-60"
          disabled={pending}
          type="submit"
        >
          {pending ? "Saving..." : initial ? "Save salesperson" : "Create salesperson"}
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
  type = "text",
  required = false,
}: {
  name: string;
  label: string;
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
