import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePermission } from "@/server/auth/server-guards";

const metrics = [
  {
    label: "Today's Sales",
    value: "PKR 284,500",
    detail: "Illustrative gross sales",
    tone: "positive" as const,
  },
  {
    label: "Active Production Batches",
    value: "6",
    detail: "Across two mock lines",
    tone: "info" as const,
  },
  {
    label: "Low Stock Items",
    value: "14",
    detail: "Illustrative attention count",
    tone: "warning" as const,
  },
  {
    label: "Customer Receivables",
    value: "PKR 1.82m",
    detail: "Illustrative open balance",
    tone: "neutral" as const,
  },
  {
    label: "Supplier Payables",
    value: "PKR 1.16m",
    detail: "Illustrative open balance",
    tone: "neutral" as const,
  },
];

const activity = [
  ["Goods receipt drafted", "PO-24018", "9 min ago"],
  ["Batch status updated", "BAT-00642", "24 min ago"],
  ["Dispatch prepared", "DSP-01138", "41 min ago"],
] as const;

export default async function DashboardPage() {
  await requirePermission("dashboard.view");
  return (
    <ResponsiveContainer>
      <PageHeader
        description="A compact operating view for production, stock, and commercial activity. Every value on this page is static demonstration data."
        title="Dashboard"
      />
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-[var(--ink)]">Operating snapshot</h2>
        <StatusBadge tone="info">Mock data</StatusBadge>
      </div>
      <section
        aria-label="Mock operating metrics"
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"
      >
        {metrics.map((metric) => (
          <Card className="min-w-0 p-4" key={metric.label}>
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-medium leading-5 text-[var(--muted)]">{metric.label}</p>
              <StatusBadge tone={metric.tone}>Mock</StatusBadge>
            </div>
            <p className="mt-4 break-words text-2xl font-bold tracking-[-0.025em] text-[var(--ink)]">
              {metric.value}
            </p>
            <p className="mt-1 text-xs text-[var(--muted)]">{metric.detail}</p>
          </Card>
        ))}
      </section>

      <div className="mt-5 grid min-w-0 gap-5 xl:grid-cols-[1.25fr_0.75fr]">
        <Card className="min-w-0 overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3 sm:px-5">
            <h2 className="text-sm font-semibold">Recent Activity</h2>
            <StatusBadge>Mock data</StatusBadge>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <thead className="bg-[var(--surface)] text-xs text-[var(--muted)]">
                <tr>
                  <th className="px-5 py-3 font-medium">Event</th>
                  <th className="px-5 py-3 font-medium">Reference</th>
                  <th className="px-5 py-3 text-right font-medium">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {activity.map(([event, reference, time]) => (
                  <tr key={reference}>
                    <td className="px-5 py-3 font-medium text-[var(--ink)]">{event}</td>
                    <td className="px-5 py-3 font-mono text-xs text-[var(--muted)]">{reference}</td>
                    <td className="px-5 py-3 text-right text-xs text-[var(--muted)]">{time}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="min-w-0 p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Production Status</h2>
            <StatusBadge>Mock data</StatusBadge>
          </div>
          <div className="mt-5 space-y-5">
            {[
              ["Mixing line A", "72%"],
              ["Packing line B", "46%"],
              ["Reprocess queue", "18%"],
            ].map(([label, progress]) => (
              <div key={label}>
                <div className="mb-2 flex justify-between gap-4 text-xs">
                  <span className="font-medium">{label}</span>
                  <span className="text-[var(--muted)]">{progress}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[var(--skeleton)]">
                  <div
                    className="h-full rounded-full bg-[var(--accent)]"
                    style={{ width: progress }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="mt-5 p-4 sm:p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Stock Alerts</h2>
          <StatusBadge tone="warning">Mock data</StatusBadge>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {[
            ["PET bottle 500 ml", "Below mock reorder point"],
            ["Mango pulp", "Illustrative 3-day cover"],
            ["Carton 12-pack", "Mock variance review"],
          ].map(([item, detail]) => (
            <div
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3"
              key={item}
            >
              <p className="text-sm font-semibold">{item}</p>
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{detail}</p>
            </div>
          ))}
        </div>
      </Card>
    </ResponsiveContainer>
  );
}
