import { Card } from "./card";

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <Card className="border-dashed px-5 py-12 text-center sm:px-8">
      <div
        className="mx-auto mb-4 grid size-10 place-items-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]"
        aria-hidden="true"
      >
        +
      </div>
      <h2 className="text-base font-semibold text-[var(--ink)]">{title}</h2>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[var(--muted)]">{description}</p>
    </Card>
  );
}
