"use client";

import { useActionState, useState } from "react";

export type UpdateActionState = {
  ok: boolean;
  message: string;
  packageId?: string;
  toVersion?: string;
};
type FormAction = (
  state: UpdateActionState | undefined,
  formData: FormData,
) => Promise<UpdateActionState>;

export type UpdateStatusView = {
  currentVersion: string;
  status:
    | { kind: "none" }
    | {
        kind: "known";
        stage: string;
        fromVersion: string;
        toVersion: string;
        updatedAt: string;
        rollbackResult: string;
      };
};

export function UpdatePanel({
  data,
  uploadUpdatePackageAction,
  installUpdateNowAction,
}: {
  data: UpdateStatusView;
  uploadUpdatePackageAction: FormAction;
  installUpdateNowAction: FormAction;
}) {
  const [verifiedPackageId, setVerifiedPackageId] = useState<string | null>(null);
  const [verifiedToVersion, setVerifiedToVersion] = useState<string | null>(null);

  const [uploadState, uploadFormAction, uploadPending] = useActionState(
    async (state: UpdateActionState | undefined, formData: FormData) => {
      const result = await uploadUpdatePackageAction(state, formData);
      if (result.ok && result.packageId) {
        setVerifiedPackageId(result.packageId);
        setVerifiedToVersion(result.toVersion ?? null);
      }
      return result;
    },
    undefined,
  );
  const [installState, installFormAction, installPending] = useActionState(
    installUpdateNowAction,
    undefined,
  );

  return (
    <div className="grid gap-4">
      <div className="rounded-lg border p-4">
        <p className="text-sm font-semibold">Currently installed version: {data.currentVersion}</p>
        {data.status.kind === "known" && (
          <dl className="mt-2 grid gap-1 text-sm">
            <div>
              <dt className="inline font-medium">Last update stage: </dt>
              <dd className="inline">{data.status.stage}</dd>
            </div>
            <div>
              <dt className="inline font-medium">Transition: </dt>
              <dd className="inline">
                {data.status.fromVersion} → {data.status.toVersion}
              </dd>
            </div>
            {data.status.rollbackResult !== "not-attempted" && (
              <div>
                <dt className="inline font-medium">Rollback: </dt>
                <dd className="inline">{data.status.rollbackResult}</dd>
              </div>
            )}
            <div>
              <dt className="inline font-medium">Updated at: </dt>
              <dd className="inline">{data.status.updatedAt}</dd>
            </div>
          </dl>
        )}
      </div>

      <form action={uploadFormAction} className="rounded-lg border p-4">
        <h2 className="text-sm font-semibold">Upload and verify an update package</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Upload a .hfupdate file received from Hamd Foods. It is verified in place -- nothing is
          installed until you explicitly confirm below.
        </p>
        <label className="mt-3 block text-sm font-medium">
          Update package
          <input
            accept=".hfupdate"
            className="mt-1 min-h-11 w-full rounded-lg border px-3 py-2 text-sm"
            name="packageFile"
            required
            type="file"
          />
        </label>
        <button
          className="mt-3 min-h-11 rounded-lg border px-4 font-semibold disabled:opacity-60"
          disabled={uploadPending}
          type="submit"
        >
          {uploadPending ? "Verifying..." : "Verify package"}
        </button>
        {uploadState && (
          <p
            className={`mt-2 text-sm ${uploadState.ok ? "text-green-700" : "text-red-700"}`}
            role="status"
          >
            {uploadState.message}
          </p>
        )}
      </form>

      {verifiedPackageId && (
        <form action={installFormAction} className="rounded-lg border border-amber-300 p-4">
          <h2 className="text-sm font-semibold">Install verified update ({verifiedToVersion})</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            The ERP will briefly stop while a backup is taken, the update is applied, and health is
            confirmed. Do not power off this machine during installation. A failed update recovers
            safely; business data is never discarded.
          </p>
          <input name="packageId" type="hidden" value={verifiedPackageId} />
          <button
            className="mt-3 min-h-11 rounded-lg bg-[var(--accent)] px-4 font-semibold text-white disabled:opacity-60"
            disabled={installPending}
            type="submit"
          >
            {installPending ? "Starting..." : "Install now"}
          </button>
          {installState && (
            <p
              className={`mt-2 text-sm ${installState.ok ? "text-green-700" : "text-red-700"}`}
              role="status"
            >
              {installState.message}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
