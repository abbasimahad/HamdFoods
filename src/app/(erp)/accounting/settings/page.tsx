import {
  AccountingPeriodForm,
  AccountingPeriodStatusForm,
  AccountingMappingForm,
  AccountingSettingsForm,
} from "@/components/accounting/accounting-management-forms";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { requirePermission } from "@/server/auth/server-guards";
import { prisma } from "@/server/db/prisma";
import { periodCloseReadiness } from "@/server/accounting/period-close";
export default async function Page() {
  await requirePermission("accounting.manage");
  const [settings, periods, accounts] = await Promise.all([
    prisma.accountingSettings.findUnique({
      where: { id: "default" },
      include: { mappings: { include: { account: true } } },
    }),
    prisma.accountingPeriod.findMany({
      include: { events: { include: { actor: true }, orderBy: { createdAt: "desc" } } },
      orderBy: { startDate: "desc" },
    }),
    prisma.accountingAccount.findMany({ orderBy: { code: "asc" } }),
  ]);
  const closeReadiness = await Promise.all(
    periods.map((period) => periodCloseReadiness(period.id)),
  );
  const readinessByPeriod = new Map(
    closeReadiness.map((readiness) => [readiness.period.id, readiness]),
  );
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Accounting Settings & Periods"
        description="Mappings are server-resolved; an OPEN period is required for new journals."
      />
      <Card className="p-5">
        <p className="text-sm">
          Base currency: <strong>{settings?.baseCurrencyCode ?? "Not configured"}</strong>; purchase
          tax treatment: <strong>{settings?.purchaseTaxTreatment ?? "Not configured"}</strong>
        </p>
        <ul className="mt-3 grid gap-1 text-sm md:grid-cols-2">
          {settings?.mappings.map((mapping) => (
            <li key={mapping.id}>
              {mapping.mappingKey}: {mapping.account.code} — {mapping.account.name}
            </li>
          ))}
        </ul>
        <div className="mt-3 grid gap-2 text-sm">
          {settings?.mappings.map((mapping) => (
            <AccountingMappingForm
              key={`edit-${mapping.id}`}
              accountId={mapping.accountId}
              accounts={accounts}
              mappingKey={mapping.mappingKey}
            />
          ))}
        </div>
        {settings ? (
          <div className="mt-4">
            <AccountingSettingsForm purchaseTaxTreatment={settings.purchaseTaxTreatment} />
          </div>
        ) : null}
      </Card>
      <Card className="mt-5 space-y-3 p-5">
        <h2 className="font-semibold">Create accounting period</h2>
        <AccountingPeriodForm />
      </Card>
      <Card className="mt-5 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="p-3 text-left">Period</th>
              <th className="p-3 text-left">Start</th>
              <th className="p-3 text-left">End</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3 text-left">Close readiness / trace</th>
              <th className="p-3 text-left">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {periods.map((period) => (
              <tr key={period.id}>
                <td className="p-3">{period.name}</td>
                <td className="p-3">{period.startDate.toISOString().slice(0, 10)}</td>
                <td className="p-3">{period.endDate.toISOString().slice(0, 10)}</td>
                <td className="p-3">{period.status}</td>
                <td className="p-3 text-xs">
                  <ul className="space-y-1">
                    {readinessByPeriod.get(period.id)?.checks.map((check) => (
                      <li
                        key={check.label}
                        className={
                          check.state === "block"
                            ? "text-red-700"
                            : check.state === "warning"
                              ? "text-amber-700"
                              : "text-emerald-700"
                        }
                      >
                        {check.state.toUpperCase()}: {check.label} — {check.detail}
                      </li>
                    ))}
                    {period.events.map((event) => (
                      <li key={event.id}>
                        {event.action} by {event.actor.name} on{" "}
                        {event.createdAt.toISOString().slice(0, 10)}
                        {event.reason ? `: ${event.reason}` : ""}
                      </li>
                    ))}
                  </ul>
                </td>
                <td className="p-3">
                  <AccountingPeriodStatusForm periodId={period.id} status={period.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </ResponsiveContainer>
  );
}
