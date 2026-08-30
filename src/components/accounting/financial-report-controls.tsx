"use client";

export function FinancialReportControls({
  from,
  to,
  asOf,
}: {
  from?: string;
  to?: string;
  asOf?: string;
}) {
  return (
    <div className="mb-4 flex flex-wrap gap-2 print:hidden">
      <form className="flex flex-wrap gap-2">
        {from !== undefined ? (
          <input
            className="rounded border px-3 py-2 text-sm"
            defaultValue={from}
            name="from"
            type="date"
          />
        ) : null}
        {to !== undefined ? (
          <input
            className="rounded border px-3 py-2 text-sm"
            defaultValue={to}
            name="to"
            type="date"
          />
        ) : null}
        {asOf !== undefined ? (
          <input
            className="rounded border px-3 py-2 text-sm"
            defaultValue={asOf}
            name="asOf"
            type="date"
          />
        ) : null}
        <button className="rounded bg-[var(--accent)] px-3 py-2 text-sm text-white">Apply</button>
      </form>
      <button
        className="rounded border px-3 py-2 text-sm"
        onClick={() => window.print()}
        type="button"
      >
        Print / save PDF
      </button>
    </div>
  );
}
