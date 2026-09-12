"use client";

import { useActionState, useMemo, useState } from "react";
import { ActionFeedback } from "@/components/ui/action-feedback";
import { FormActions } from "@/components/ui/form-actions";
import type { CustomerRecord, SalesReferenceData } from "@/modules/sales/application/contracts";
import { initialSalesActionState, type SalesAction } from "./action-state";

export function CustomerForm({
  action,
  initial,
  references,
}: {
  action: SalesAction;
  initial?: CustomerRecord;
  references: SalesReferenceData;
}) {
  const [state, formAction, pending] = useActionState(action, initialSalesActionState);
  const [areaId, setAreaId] = useState(initial?.areaId ?? "");
  const routes = useMemo(
    () =>
      references.routes.filter((route) => route.areaId === areaId || route.id === initial?.routeId),
    [areaId, initial?.routeId, references.routes],
  );
  return (
    <form action={formAction} className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {initial && <input name="id" type="hidden" value={initial.id} />}
      <Section title="Basic information" />
      <Field name="code" label="Customer code" defaultValue={initial?.code ?? ""} required />
      <Field
        name="name"
        label="Customer / business name"
        defaultValue={initial?.name ?? ""}
        required
      />
      <Select
        name="customerGroupId"
        label="Customer group"
        defaultValue={initial?.customerGroupId ?? ""}
        options={references.groups}
        empty="No group"
      />
      <Field
        name="contactPerson"
        label="Contact person"
        defaultValue={initial?.contactPerson ?? ""}
      />
      <Section title="Contact" />
      <Field name="phone" label="Phone" defaultValue={initial?.phone ?? ""} required />
      <Field
        name="secondaryPhone"
        label="Secondary phone"
        defaultValue={initial?.secondaryPhone ?? ""}
      />
      <Field name="email" label="Email" type="email" defaultValue={initial?.email ?? ""} />
      <Section title="Address and sales assignment" />
      <label className="text-sm font-medium md:col-span-2 xl:col-span-3">
        Address
        <textarea
          className="mt-1 min-h-20 w-full rounded-lg border border-[var(--border)] px-3 py-2"
          defaultValue={initial?.address}
          name="address"
          required
        />
      </label>
      <Field name="city" label="City" defaultValue={initial?.city ?? ""} />
      <label className="text-sm font-medium">
        Area
        <select
          className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] px-3"
          defaultValue={areaId}
          name="areaId"
          onChange={(event) => setAreaId(event.target.value)}
          required
        >
          <option value="">Select area</option>
          {references.areas.map((area) => (
            <option key={area.id} value={area.id}>
              {area.code} — {area.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm font-medium">
        Route
        <select
          className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] px-3"
          defaultValue={initial?.routeId ?? ""}
          key={areaId}
          name="routeId"
        >
          <option value="">No route</option>
          {routes.map((route) => (
            <option key={route.id} value={route.id}>
              {route.code} — {route.name}
            </option>
          ))}
        </select>
      </label>
      <Select
        name="salespersonId"
        label="Salesperson"
        defaultValue={initial?.salespersonId ?? ""}
        options={references.salespersons}
        empty="No salesperson"
      />
      <Section title="Commercial settings" />
      <Field
        name="creditLimit"
        label="Credit limit"
        defaultValue={initial?.creditLimit ?? ""}
        inputMode="decimal"
      />
      <Field
        name="paymentTermsDays"
        label="Payment terms (days)"
        defaultValue={initial?.paymentTermsDays?.toString() ?? ""}
        type="number"
      />
      <Section title="Additional" />
      <Field
        name="taxRegistrationNo"
        label="Tax / registration no."
        defaultValue={initial?.taxRegistrationNo ?? ""}
      />
      <label className="text-sm font-medium md:col-span-2 xl:col-span-3">
        Notes
        <textarea
          className="mt-1 min-h-20 w-full rounded-lg border border-[var(--border)] px-3 py-2"
          defaultValue={initial?.notes ?? ""}
          name="notes"
        />
      </label>
      <FormActions
        className="md:col-span-2 xl:col-span-3"
        disabled={pending}
        onCancel={(event) => event.currentTarget.form?.reset()}
        pendingLabel="Saving…"
        submitLabel={initial ? "Save customer" : "Create customer"}
      />
      <ActionFeedback
        className="md:col-span-2 xl:col-span-3"
        message={state.message}
        ok={state.ok}
      />
    </form>
  );
}
function Section({ title }: { title: string }) {
  return (
    <h2 className="border-b border-[var(--border)] pb-1 text-base font-semibold md:col-span-2 xl:col-span-3">
      {title}
    </h2>
  );
}
function Field({
  name,
  label,
  defaultValue,
  type = "text",
  required = false,
  inputMode,
}: {
  name: string;
  label: string;
  defaultValue: string | undefined;
  type?: string;
  required?: boolean;
  inputMode?: "decimal";
}) {
  return (
    <label className="text-sm font-medium">
      {label}
      <input
        className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] px-3"
        defaultValue={defaultValue}
        inputMode={inputMode}
        min={type === "number" ? 0 : undefined}
        name={name}
        required={required}
        type={type}
      />
    </label>
  );
}
function Select({
  name,
  label,
  defaultValue,
  options,
  empty,
}: {
  name: string;
  label: string;
  defaultValue: string;
  options: readonly { id: string; code: string; name: string }[];
  empty: string;
}) {
  return (
    <label className="text-sm font-medium">
      {label}
      <select
        className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] px-3"
        defaultValue={defaultValue}
        name={name}
      >
        <option value="">{empty}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.code} — {option.name}
          </option>
        ))}
      </select>
    </label>
  );
}
