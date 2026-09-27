"use client";
export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <button
      className="print:hidden rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
      onClick={() => window.print()}
      type="button"
    >
      {label}
    </button>
  );
}
