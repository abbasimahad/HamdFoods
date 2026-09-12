export function ActionFeedback({
  message,
  ok = false,
  className = "",
}: {
  message?: string;
  ok?: boolean;
  className?: string;
}) {
  if (!message) return null;
  return (
    <p
      className={`rounded-lg border px-3 py-2 text-sm ${
        ok
          ? "border-[var(--success-border)] bg-[var(--success-surface)] text-[var(--success-ink)]"
          : "border-[var(--danger-border)] bg-[var(--danger-surface)] text-[var(--danger-ink)]"
      } ${className}`}
      role={ok ? "status" : "alert"}
    >
      {message}
    </p>
  );
}
