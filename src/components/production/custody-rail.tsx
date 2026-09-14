import type { ReactNode } from "react";

export function CustodyRail({ nodes }: { nodes: readonly { label: string; value: ReactNode }[] }) {
  return (
    <ol
      aria-label="Custody and genealogy"
      className="grid gap-2 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-stretch"
    >
      {nodes.map((node, index) => (
        <li className="contents" key={node.label}>
          <div className="min-w-0 rounded-lg border border-[var(--control-border)] bg-[var(--raised)] p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              {node.label}
            </p>
            <div className="mt-1 break-words text-sm font-semibold text-[var(--ink)]">
              {node.value}
            </div>
          </div>
          {index < nodes.length - 1 && (
            <span
              aria-hidden="true"
              className="grid place-items-center text-lg font-bold text-[var(--accent)] max-md:rotate-90"
            >
              &rarr;
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
