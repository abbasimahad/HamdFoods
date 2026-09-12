"use client";

import Link from "next/link";
import type { MouseEvent } from "react";

import { PendingButton } from "./pending-button";

export function FormActions({
  submitLabel,
  pendingLabel,
  cancelHref,
  onCancel,
  disabled,
  className = "",
}: {
  submitLabel: string;
  pendingLabel: string;
  cancelHref?: string;
  onCancel?: (event: MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-3 ${className}`}>
      <PendingButton disabled={disabled} pendingLabel={pendingLabel}>
        {submitLabel}
      </PendingButton>
      {cancelHref ? (
        <Link
          className="inline-flex min-h-11 items-center rounded-lg border border-[var(--control-border)] bg-white px-4 py-2 text-sm font-semibold text-[var(--ink)]"
          href={cancelHref}
        >
          Cancel
        </Link>
      ) : onCancel ? (
        <button
          className="min-h-11 rounded-lg border border-[var(--control-border)] bg-white px-4 py-2 text-sm font-semibold text-[var(--ink)]"
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
      ) : null}
    </div>
  );
}
