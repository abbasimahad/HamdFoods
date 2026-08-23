import type { ReactNode } from "react";

type StatusTone = "neutral" | "positive" | "warning" | "info";

const toneClasses: Record<StatusTone, string> = {
  neutral: "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]",
  positive: "border-[var(--success-border)] bg-[var(--success-surface)] text-[var(--success-ink)]",
  warning: "border-[var(--warning-border)] bg-[var(--warning-surface)] text-[var(--warning-ink)]",
  info: "border-[var(--info-border)] bg-[var(--info-surface)] text-[var(--info-ink)]",
};

export function StatusBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: StatusTone;
}) {
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[0.6875rem] font-semibold ${toneClasses[tone]}`}
    >
      {children}
    </span>
  );
}
