import Link from "next/link";

export function SearchPagination({
  route,
  query,
  page,
  pageCount,
  total,
}: {
  route: string;
  query: string;
  page: number;
  pageCount: number;
  total: number;
}) {
  const pageHref = (target: number) =>
    `${route}?${new URLSearchParams({ ...(query ? { q: query } : {}), page: String(target) })}`;
  return (
    <div className="flex flex-col gap-3 border-t border-[var(--border)] p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs text-[var(--muted)]">
        {total} record{total === 1 ? "" : "s"} · Page {page} of {pageCount}
      </p>
      <div className="flex gap-2">
        {page > 1 && (
          <Link
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
            href={pageHref(page - 1)}
          >
            Previous
          </Link>
        )}
        {page < pageCount && (
          <Link
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
            href={pageHref(page + 1)}
          >
            Next
          </Link>
        )}
      </div>
    </div>
  );
}

export function MasterSearch({ route, defaultValue }: { route: string; defaultValue: string }) {
  return (
    <form action={route} className="mb-4 flex flex-col gap-2 sm:flex-row">
      <label className="sr-only" htmlFor={`search-${route}`}>
        Search by code or name
      </label>
      <input
        className="min-h-11 flex-1 rounded-lg border border-[var(--border)] bg-white px-3"
        defaultValue={defaultValue}
        id={`search-${route}`}
        maxLength={100}
        name="q"
        placeholder="Search by code or name"
      />
      <button
        className="min-h-11 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white"
        type="submit"
      >
        Search
      </button>
      {defaultValue && (
        <Link
          className="min-h-11 rounded-lg border border-[var(--border)] px-4 py-3 text-center text-sm"
          href={route}
        >
          Clear
        </Link>
      )}
    </form>
  );
}
