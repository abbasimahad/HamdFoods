import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { Card } from "@/components/ui/card";
import { auditDetail } from "@/server/audit/audit-history";
import { requirePermission } from "@/server/auth/server-guards";
const pretty = (value: unknown) =>
  value ? (
    Object.entries(value as Record<string, unknown>).map(([key, item]) => (
      <li key={key}>
        <strong>{key}:</strong> {String(item)}
      </li>
    ))
  ) : (
    <li>None</li>
  );
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("audit.view");
  const event = await auditDetail((await params).id);
  if (!event) notFound();
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Audit Event"
        description={`${event.action} · ${event.entityReference ?? event.entityType}`}
      />
      <Card className="space-y-4 p-5 text-sm">
        <dl className="grid gap-2 md:grid-cols-2">
          <dt>Timestamp</dt>
          <dd>{event.occurredAt.toLocaleString()}</dd>
          <dt>Actor</dt>
          <dd>{event.actor.name}</dd>
          <dt>Module</dt>
          <dd>{event.module}</dd>
          <dt>Entity</dt>
          <dd>
            {event.entityType} / {event.entityReference ?? event.entityId}
          </dd>
          <dt>Reason code</dt>
          <dd>{event.reasonCode ?? "—"}</dd>
          <dt>Reason</dt>
          <dd>{event.reason ?? "—"}</dd>
          <dt>Related</dt>
          <dd>{event.relatedReference ?? event.relatedEntityId ?? "—"}</dd>
        </dl>
        <div>
          <h2 className="font-semibold">Description</h2>
          <p>{event.description}</p>
        </div>
        <div>
          <h2 className="font-semibold">Before</h2>
          <ul>{pretty(event.beforeSnapshot)}</ul>
        </div>
        <div>
          <h2 className="font-semibold">After</h2>
          <ul>{pretty(event.afterSnapshot)}</ul>
        </div>
        <div>
          <h2 className="font-semibold">Context</h2>
          <ul>{pretty(event.metadata)}</ul>
        </div>
      </Card>
    </ResponsiveContainer>
  );
}
