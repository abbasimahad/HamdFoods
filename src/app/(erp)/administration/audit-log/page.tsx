import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { Card } from "@/components/ui/card";
import { auditPage, controlEventSummary } from "@/server/audit/audit-history";
import { requirePermission } from "@/server/auth/server-guards";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requirePermission("audit.view");
  const query = await searchParams;
  const [result, controls] = await Promise.all([auditPage(query), controlEventSummary()]);
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Audit & Controls"
        description="Append-only server-recorded business activity and high-risk control events."
      />
      <Card className="mb-4 p-4">
        <form className="grid gap-2 md:grid-cols-4">
          <input
            className="rounded border px-3 py-2"
            defaultValue={query.from ?? ""}
            name="from"
            type="date"
          />
          <input
            className="rounded border px-3 py-2"
            defaultValue={query.to ?? ""}
            name="to"
            type="date"
          />
          <select
            className="rounded border px-3 py-2"
            defaultValue={query.userId ?? ""}
            name="userId"
          >
            <option value="">All users</option>
            {result.users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
          <select
            className="rounded border px-3 py-2"
            defaultValue={query.module ?? ""}
            name="module"
          >
            <option value="">All modules</option>
            {result.modules.map((module) => (
              <option key={module} value={module}>
                {module}
              </option>
            ))}
          </select>
          <input
            className="rounded border px-3 py-2"
            defaultValue={query.reference ?? ""}
            name="reference"
            placeholder="Reference, entity ID, or description"
          />
          <input
            className="rounded border px-3 py-2"
            defaultValue={query.action ?? ""}
            name="action"
            placeholder="Action, e.g. REVERSE"
          />
          <input
            className="rounded border px-3 py-2"
            defaultValue={query.entityType ?? ""}
            name="entityType"
            placeholder="Entity type"
          />
          <button className="rounded bg-[var(--accent)] px-3 py-2 text-white">Apply filters</button>
        </form>
      </Card>
      <Card className="mb-4 overflow-hidden">
        <h2 className="p-3 font-semibold">Recent control events</h2>
        <ul className="divide-y text-sm">
          {controls.map((event) => (
            <li className="p-3" key={event.id}>
              {event.occurredAt.toLocaleString()} · {event.action} ·{" "}
              {event.entityReference ?? event.entityType} · {event.actor.name}
            </li>
          ))}
        </ul>
      </Card>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="p-3 text-left">Date / time</th>
              <th className="p-3 text-left">User</th>
              <th className="p-3 text-left">Module</th>
              <th className="p-3 text-left">Action</th>
              <th className="p-3 text-left">Entity</th>
              <th className="p-3 text-left">Description / reason</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {result.events.map((event) => (
              <tr key={event.id}>
                <td className="p-3">{event.occurredAt.toLocaleString()}</td>
                <td className="p-3">{event.actor.name}</td>
                <td className="p-3">{event.module}</td>
                <td className="p-3">{event.action}</td>
                <td className="p-3">
                  <Link
                    className="text-[var(--accent)]"
                    href={`/administration/audit-log/${event.id}`}
                  >
                    {event.entityReference ?? event.entityType}
                  </Link>
                </td>
                <td className="p-3">
                  {event.description}
                  {event.reason ? ` — ${event.reason}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </ResponsiveContainer>
  );
}
