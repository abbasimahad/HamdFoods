"use client";

import { useState } from "react";

export type BarDatum = { key: string; label: string; value: number; detail?: string };

/**
 * Single-series bar chart. The title names the series, so no legend is drawn; marks use the
 * app accent, text stays in ink tokens, and every bar has a hover/focus tooltip. A visually
 * hidden table carries the same numbers for screen readers.
 */
export function BarChart({
  data,
  orientation = "vertical",
  valueFormat = "money",
  caption,
}: {
  data: readonly BarDatum[];
  orientation?: "vertical" | "horizontal";
  valueFormat?: "money" | "count";
  caption: string;
}) {
  const formatValue = valueFormat === "money" ? formatRupees : formatCount;
  const [active, setActive] = useState<string | null>(null);
  const max = Math.max(0, ...data.map((datum) => datum.value));
  const scale = (value: number) => (max > 0 ? Math.max(value / max, value > 0 ? 0.02 : 0) : 0);
  const activeDatum = data.find((datum) => datum.key === active);

  return (
    <figure className="relative m-0 min-w-0">
      {orientation === "vertical" ? (
        <div
          className="flex h-48 items-end gap-2 border-b border-[var(--border)] sm:gap-3"
          role="presentation"
        >
          {data.map((datum) => (
            <button
              aria-label={`${datum.label}: ${formatValue(datum.value)}`}
              className="group relative flex h-full min-w-0 flex-1 cursor-default flex-col justify-end rounded-t outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
              key={datum.key}
              onBlur={() => setActive(null)}
              onFocus={() => setActive(datum.key)}
              onMouseEnter={() => setActive(datum.key)}
              onMouseLeave={() => setActive(null)}
              type="button"
            >
              <span
                className={`mx-auto block w-full max-w-12 rounded-t-[4px] transition-colors ${
                  active === datum.key ? "bg-[var(--accent-strong)]" : "bg-[var(--accent)]"
                }`}
                style={{ height: `${scale(datum.value) * 100}%` }}
              />
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-2" role="presentation">
          {data.map((datum) => (
            <button
              aria-label={`${datum.label}: ${formatValue(datum.value)}`}
              className="block w-full cursor-default rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
              key={datum.key}
              onBlur={() => setActive(null)}
              onFocus={() => setActive(datum.key)}
              onMouseEnter={() => setActive(datum.key)}
              onMouseLeave={() => setActive(null)}
              type="button"
            >
              <span className="mb-1 flex justify-between gap-3 text-xs">
                <span className="truncate font-medium text-[var(--ink)]">{datum.label}</span>
                <span className="shrink-0 tabular-nums text-[var(--muted)]">
                  {formatValue(datum.value)}
                </span>
              </span>
              <span className="block h-2.5 rounded-[4px] bg-[var(--skeleton)]">
                <span
                  className={`block h-full rounded-[4px] transition-colors ${
                    active === datum.key ? "bg-[var(--accent-strong)]" : "bg-[var(--accent)]"
                  }`}
                  style={{ width: `${scale(datum.value) * 100}%` }}
                />
              </span>
            </button>
          ))}
        </div>
      )}
      {orientation === "vertical" ? (
        <div className="mt-2 flex gap-2 sm:gap-3" aria-hidden="true">
          {data.map((datum) => (
            <span
              className={`min-w-0 flex-1 truncate text-center text-[0.6875rem] ${
                active === datum.key ? "font-semibold text-[var(--ink)]" : "text-[var(--muted)]"
              }`}
              key={datum.key}
            >
              {datum.label}
            </span>
          ))}
        </div>
      ) : null}
      {activeDatum ? (
        <div
          className="pointer-events-none absolute right-0 top-0 z-10 rounded-lg border border-[var(--border)] bg-[var(--raised)] px-3 py-2 text-xs shadow-lg"
          role="status"
        >
          <p className="font-semibold text-[var(--ink)]">{activeDatum.label}</p>
          <p className="tabular-nums text-[var(--ink)]">{formatValue(activeDatum.value)}</p>
          {activeDatum.detail ? <p className="text-[var(--muted)]">{activeDatum.detail}</p> : null}
        </div>
      ) : null}
      <table className="sr-only">
        <caption>{caption}</caption>
        <tbody>
          {data.map((datum) => (
            <tr key={datum.key}>
              <th scope="row">{datum.label}</th>
              <td>{formatValue(datum.value)}</td>
              {datum.detail ? <td>{datum.detail}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

const rupees = new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 });
export function formatRupees(value: number) {
  return `Rs ${rupees.format(Math.round(value))}`;
}
function formatCount(value: number) {
  return rupees.format(value);
}
