export function LineEditorControls({
  onAdd,
  addLabel = "+ Add Line",
  onRemove,
  removeDisabled = false,
}: {
  onAdd?: () => void;
  addLabel?: string;
  onRemove?: () => void;
  removeDisabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {onAdd ? (
        <button
          className="min-h-11 rounded-lg border border-[var(--control-border)] bg-white px-3 py-2 text-sm font-semibold text-[var(--accent)]"
          onClick={onAdd}
          type="button"
        >
          {addLabel}
        </button>
      ) : null}
      {onRemove ? (
        <button
          className="min-h-11 rounded-lg border border-[var(--danger-border)] bg-[var(--danger-surface)] px-3 py-2 text-sm font-semibold text-[var(--danger-ink)] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={removeDisabled}
          onClick={onRemove}
          type="button"
        >
          Remove
        </button>
      ) : null}
    </div>
  );
}
