export function LoadingState() {
  return (
    <div aria-label="Loading page" aria-live="polite" className="grid gap-4">
      <div className="h-20 animate-pulse rounded-xl bg-[var(--skeleton)]" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div className="h-32 animate-pulse rounded-xl bg-[var(--skeleton)]" key={item} />
        ))}
      </div>
    </div>
  );
}
