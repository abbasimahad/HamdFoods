"use client";

import { useActionState } from "react";
import type { CompanyProfileMutationResult } from "@/modules/administration/application/company-profile-contracts";
import type { CompanyProfileRecord } from "@/modules/administration/application/company-profile-contracts";
import { formatDateTimeUtc } from "@/components/ui/format-datetime";

type Action = (
  state: CompanyProfileMutationResult | undefined,
  formData: FormData,
) => Promise<CompanyProfileMutationResult>;

export function CompanyProfileForm({
  action,
  profile,
}: {
  action: Action;
  profile: CompanyProfileRecord;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="grid gap-3 md:grid-cols-2">
      <label className="text-sm font-medium md:col-span-2">
        Legal / trading name
        <input
          className="mt-1 min-h-11 w-full rounded-lg border px-3"
          defaultValue={profile.legalName}
          maxLength={200}
          name="legalName"
          required
        />
      </label>
      <label className="text-sm font-medium md:col-span-2">
        Address
        <input
          className="mt-1 min-h-11 w-full rounded-lg border px-3"
          defaultValue={profile.address ?? ""}
          maxLength={500}
          name="address"
        />
      </label>
      <label className="text-sm font-medium">
        City
        <input
          className="mt-1 min-h-11 w-full rounded-lg border px-3"
          defaultValue={profile.city ?? ""}
          maxLength={120}
          name="city"
        />
      </label>
      <label className="text-sm font-medium">
        Phone
        <input
          className="mt-1 min-h-11 w-full rounded-lg border px-3"
          defaultValue={profile.phone ?? ""}
          maxLength={40}
          name="phone"
        />
      </label>
      <label className="text-sm font-medium">
        Email
        <input
          className="mt-1 min-h-11 w-full rounded-lg border px-3"
          defaultValue={profile.email ?? ""}
          maxLength={200}
          name="email"
          type="email"
        />
      </label>
      <label className="text-sm font-medium">
        Tax registration number
        <input
          className="mt-1 min-h-11 w-full rounded-lg border px-3"
          defaultValue={profile.taxRegistrationNo ?? ""}
          maxLength={60}
          name="taxRegistrationNo"
        />
      </label>
      <div className="flex flex-wrap items-center gap-3 md:col-span-2">
        <button
          className="min-h-11 rounded-lg bg-[var(--accent)] px-5 font-semibold text-white disabled:opacity-60"
          disabled={pending}
          type="submit"
        >
          {pending ? "Saving..." : "Save company profile"}
        </button>
        {state && (
          <p className={`text-sm ${state.ok ? "text-green-700" : "text-red-700"}`} role="status">
            {state.ok ? "Company profile saved." : state.message}
          </p>
        )}
      </div>
      <p className="text-xs text-[var(--muted)] md:col-span-2">
        Used on printed documents (purchase orders, invoices, payments, transfers) and the
        application header. Does not affect inventory, valuation, accounting mappings, accounting
        periods, permissions, posted documents, production costing, or tax authority.
      </p>
      {profile.updatedByName && (
        <p className="text-xs text-[var(--muted)] md:col-span-2">
          Last updated by {profile.updatedByName} on {formatDateTimeUtc(profile.updatedAt)}
        </p>
      )}
    </form>
  );
}
