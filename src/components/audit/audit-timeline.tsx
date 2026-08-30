import { Card } from "@/components/ui/card";
import { entityAuditTimeline } from "@/server/audit/audit-history";

export async function AuditTimeline({
  entityType,
  entityId,
}: {
  entityType: string;
  entityId: string;
}) {
  const events = await entityAuditTimeline(entityType, entityId);
  if (!events.length) return null;
  return (
    <Card className="mt-5 overflow-hidden">
      <h2 className="p-4 font-semibold">Audit / History</h2>
      <ul className="divide-y text-sm">
        {events.map((event) => (
          <li className="p-4" key={event.id}>
            <p>
              <strong>{event.action}</strong> · {event.occurredAt.toLocaleString()} ·{" "}
              {event.actor.name}
            </p>
            <p className="text-[var(--muted)]">
              {event.description}
              {event.reason ? ` Reason: ${event.reason}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
}
