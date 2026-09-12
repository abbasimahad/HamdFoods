"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useFormStatus } from "react-dom";

export function PendingButton({
  children,
  pendingLabel,
  disabled,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  pendingLabel: string;
}) {
  const { pending } = useFormStatus();
  const unavailable = disabled || pending;
  return (
    <button
      aria-disabled={unavailable}
      className={`min-h-11 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
      disabled={unavailable}
      type="submit"
      {...props}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
