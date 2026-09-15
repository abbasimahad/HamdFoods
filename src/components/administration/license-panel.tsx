"use client";

import { useActionState } from "react";

import type { LicenseState } from "@/modules/licensing/domain/license";

export type LicenseActionState = { ok: boolean; message: string };
type FormAction = (
  state: LicenseActionState | undefined,
  formData: FormData,
) => Promise<LicenseActionState>;

export type LicenseStatusView = {
  state: LicenseState;
  mutationAllowed: boolean;
  daysRemaining: number | null;
  customer: string | null;
  expiresAt: string | null;
  maskedFingerprint: string | null;
  computedAt: string;
};

const STATE_COPY: Record<LicenseState, { label: string; tone: "ok" | "warning" | "restricted" }> = {
  SETUP_GRACE: { label: "Unlicensed (setup grace period)", tone: "warning" },
  VALID: { label: "Licensed", tone: "ok" },
  EXPIRY_GRACE: { label: "License expired (grace period)", tone: "warning" },
  EXPIRED: { label: "Unlicensed", tone: "restricted" },
  MACHINE_MISMATCH: { label: "License bound to different hardware", tone: "restricted" },
  INVALID_SIGNATURE: { label: "Invalid license", tone: "restricted" },
  TAMPERED_STATE: { label: "License state could not be verified", tone: "restricted" },
  CLOCK_ROLLBACK: { label: "System clock inconsistency detected", tone: "restricted" },
};

const TONE_CLASSES: Record<"ok" | "warning" | "restricted", string> = {
  ok: "border-green-300 bg-green-50 text-green-800",
  warning: "border-amber-300 bg-amber-50 text-amber-900",
  restricted: "border-red-300 bg-red-50 text-red-900",
};

export function LicensePanel({
  status,
  generateActivationRequestAction,
  importLicenseFileAction,
  resetLocalLicenseStateAction,
}: {
  status: LicenseStatusView;
  generateActivationRequestAction: FormAction;
  importLicenseFileAction: FormAction;
  resetLocalLicenseStateAction: FormAction;
}) {
  const copy = STATE_COPY[status.state];
  const showResetAction = status.state === "TAMPERED_STATE" || status.state === "CLOCK_ROLLBACK";

  return (
    <div className="grid gap-4">
      <div className={`rounded-lg border p-4 ${TONE_CLASSES[copy.tone]}`}>
        <p className="text-sm font-semibold">{copy.label}</p>
        <dl className="mt-2 grid gap-1 text-sm">
          {status.customer && (
            <div>
              <dt className="inline font-medium">Customer: </dt>
              <dd className="inline">{status.customer}</dd>
            </div>
          )}
          {status.expiresAt && (
            <div>
              <dt className="inline font-medium">Expires: </dt>
              <dd className="inline">{status.expiresAt}</dd>
            </div>
          )}
          {status.daysRemaining !== null && (
            <div>
              <dt className="inline font-medium">Days remaining: </dt>
              <dd className="inline">{status.daysRemaining}</dd>
            </div>
          )}
          {status.maskedFingerprint && (
            <div>
              <dt className="inline font-medium">Machine fingerprint: </dt>
              <dd className="inline font-mono">{status.maskedFingerprint}</dd>
            </div>
          )}
          <div>
            <dt className="inline font-medium">Business mutations: </dt>
            <dd className="inline">{status.mutationAllowed ? "Allowed" : "Blocked"}</dd>
          </div>
        </dl>
        {!status.mutationAllowed && (
          <p className="mt-2 text-sm">
            This installation is not licensed. Contact Hamd Foods to activate. Reading, printing,
            reporting, backup, and restore remain fully available.
          </p>
        )}
      </div>

      <ActivationRequestForm action={generateActivationRequestAction} />
      <ImportLicenseForm action={importLicenseFileAction} />
      {showResetAction && <ResetLocalStateForm action={resetLocalLicenseStateAction} />}
    </div>
  );
}

function ActionMessage({ state }: { state: LicenseActionState | undefined }) {
  if (!state) return null;
  return (
    <p className={`text-sm ${state.ok ? "text-green-700" : "text-red-700"}`} role="status">
      {state.message}
    </p>
  );
}

function ActivationRequestForm({ action }: { action: FormAction }) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="rounded-lg border p-4">
      <h2 className="text-sm font-semibold">Generate activation request</h2>
      <p className="mt-1 text-xs text-[var(--muted)]">
        Creates an activation request containing this machine&apos;s non-secret fingerprint. Send it
        to Hamd Foods to receive a signed license file for this machine.
      </p>
      <button
        className="mt-3 min-h-11 rounded-lg border px-4 font-semibold disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Generating..." : "Generate activation request"}
      </button>
      <div className="mt-2">
        <ActionMessage state={state} />
      </div>
    </form>
  );
}

function ImportLicenseForm({ action }: { action: FormAction }) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="rounded-lg border p-4">
      <h2 className="text-sm font-semibold">Import signed license</h2>
      <p className="mt-1 text-xs text-[var(--muted)]">
        Import the .lic file received from Hamd Foods after sending an activation request.
      </p>
      <label className="mt-3 block text-sm font-medium">
        License file
        <input
          accept=".lic,application/json"
          className="mt-1 min-h-11 w-full rounded-lg border px-3 py-2 text-sm"
          name="licenseFile"
          required
          type="file"
        />
      </label>
      <button
        className="mt-3 min-h-11 rounded-lg bg-[var(--accent)] px-4 font-semibold text-white disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Importing..." : "Import license"}
      </button>
      <div className="mt-2">
        <ActionMessage state={state} />
      </div>
    </form>
  );
}

function ResetLocalStateForm({ action }: { action: FormAction }) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="rounded-lg border border-red-300 p-4">
      <h2 className="text-sm font-semibold">Reset local license state</h2>
      <p className="mt-1 text-xs text-[var(--muted)]">
        Use only when local license state could not be verified or a clock inconsistency was
        detected. This clears only the local cache and does not change a signed license file or its
        machine binding.
      </p>
      <button
        className="mt-3 min-h-11 rounded-lg border border-red-400 px-4 font-semibold text-red-700 disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Resetting..." : "Reset local state"}
      </button>
      <div className="mt-2">
        <ActionMessage state={state} />
      </div>
    </form>
  );
}
