import { StatusBadge } from "@/components/ui/status-badge";

export function PageHeader({
  title,
  description,
  eyebrow = "Factory ERP",
}: {
  title: string;
  description: string;
  eyebrow?: string;
}) {
  return (
    <header className="mb-5 flex flex-col gap-3 border-b border-[var(--border)] pb-5 sm:mb-7 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--accent)]">
          {eyebrow} / {title}
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-[-0.025em] text-[var(--ink)] sm:text-3xl">
          {title}
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)] sm:text-base">
          {description}
        </p>
      </div>
      <div className="shrink-0">
        <StatusBadge tone="info">Phase 2 shell</StatusBadge>
      </div>
    </header>
  );
}
