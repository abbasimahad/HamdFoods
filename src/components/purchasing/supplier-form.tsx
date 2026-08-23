"use client";

import { useActionState } from "react";

import type { SupplierRecord } from "@/modules/purchasing/application/contracts";

import { initialPurchasingActionState, type PurchasingAction } from "./action-state";

export function SupplierForm({
  action,
  initial,
}: {
  action: PurchasingAction;
  initial?: SupplierRecord;
}) {
  const [state, formAction, pending] = useActionState(action, initialPurchasingActionState);
  return (
    <form action={formAction} className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {initial && <input name="id" type="hidden" value={initial.id} />}
      <Field name="code" label="Supplier code" defaultValue={initial?.code} required />
      <Field name="name" label="Business name" defaultValue={initial?.name} required />
      <Field
        name="contactPerson"
        label="Contact person"
        defaultValue={initial?.contactPerson}
        required
      />
      <Field name="phone" label="Phone" defaultValue={initial?.phone} required />
      <Field
        name="secondaryPhone"
        label="Secondary phone"
        defaultValue={initial?.secondaryPhone ?? ""}
      />
      <Field name="email" label="Email" type="email" defaultValue={initial?.email} required />
      <Field name="city" label="City" defaultValue={initial?.city} required />
      <Field
        name="taxRegistrationNo"
        label="Tax / registration no."
        defaultValue={initial?.taxRegistrationNo ?? ""}
      />
      <Field
        name="paymentTermsDays"
        label="Payment terms (days)"
        type="number"
        defaultValue={initial?.paymentTermsDays?.toString() ?? ""}
      />
      <label className="text-sm font-medium md:col-span-2 xl:col-span-3">
        Address
        <textarea
          className="mt-1 min-h-20 w-full rounded-lg border border-[var(--border)] px-3 py-2"
          defaultValue={initial?.address}
          name="address"
          required
        />
      </label>
      <label className="text-sm font-medium md:col-span-2 xl:col-span-3">
        Notes
        <textarea
          className="mt-1 min-h-20 w-full rounded-lg border border-[var(--border)] px-3 py-2"
          defaultValue={initial?.notes ?? ""}
          name="notes"
        />
      </label>
      <div className="flex items-center gap-3 md:col-span-2 xl:col-span-3">
        <button
          className="min-h-11 rounded-lg bg-[var(--accent)] px-4 font-semibold text-white disabled:opacity-60"
          disabled={pending}
          type="submit"
        >
          {pending ? "Saving..." : initial ? "Save supplier" : "Create supplier"}
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

function Field({
  name,
  label,
  defaultValue,
  type = "text",
  required = false,
}: {
  name: string;
  label: string;
  defaultValue?: string | undefined;
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
        min={type === "number" ? 0 : undefined}
      />
    </label>
  );
}
