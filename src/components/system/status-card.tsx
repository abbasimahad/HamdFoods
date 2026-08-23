import type { ReactNode } from "react";

type StatusTone = "healthy" | "unavailable";

interface StatusCardProps {
  detail: string;
  label: string;
  status: string;
  tone: StatusTone;
  trace: ReactNode;
}

export function StatusCard({ detail, label, status, tone, trace }: StatusCardProps) {
  const statusClasses =
    tone === "healthy"
      ? "border-[var(--success-border)] bg-[var(--success-surface)] text-[var(--success-ink)]"
      : "border-[var(--danger-border)] bg-[var(--danger-surface)] text-[var(--danger-ink)]";

  return (
    <article className="relative min-w-0 border-t border-[var(--border)] py-6 md:border-t-0 md:border-l md:px-6 md:py-2 first:md:border-l-0 first:md:pl-0 last:md:pr-0">
      <div className="mb-7 flex items-center justify-between gap-4">
        <span className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
          {trace}
        </span>
        <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClasses}`}>
          {status}
        </span>
      </div>
      <h3 className="text-lg font-semibold tracking-[-0.02em] text-[var(--ink)]">{label}</h3>
      <p className="mt-2 max-w-sm text-sm leading-6 text-[var(--muted)]">{detail}</p>
    </article>
  );
}
