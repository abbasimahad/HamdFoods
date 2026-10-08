import Decimal from "decimal.js";
import Link from "next/link";
import type { ReactNode } from "react";
import { BarChart } from "@/components/dashboard/bar-chart";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { formatDocumentDate, formatMoney } from "@/components/ui/format-money";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { StatusBadge } from "@/components/ui/status-badge";
import { hasPermission } from "@/modules/access/domain/principal";
import { requirePermission } from "@/server/auth/server-guards";
import {
  financialSnapshot,
  pendingWork,
  productionSnapshot,
  recentActivity,
  salesSnapshot,
  stockAlerts,
} from "@/server/dashboard/dashboard-queries";

// Always render with current figures.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const principal = await requirePermission("dashboard.view");
  const can = {
    sales: hasPermission(principal, "sales.view"),
    accounting: hasPermission(principal, "accounting.view"),
    inventory: hasPermission(principal, "inventory.view"),
    production: hasPermission(principal, "production.view"),
    purchasing: hasPermission(principal, "purchasing.view"),
    audit: hasPermission(principal, "audit.view"),
  };
  const [finance, sales, production, stock, pending, activity] = await Promise.all([
    can.accounting ? financialSnapshot() : null,
    can.sales || can.accounting ? salesSnapshot() : null,
    can.production ? productionSnapshot() : null,
    can.inventory ? stockAlerts() : null,
    pendingWork(can),
    can.audit ? recentActivity() : null,
  ]);

  const salesChange =
    sales?.previous && new Decimal(sales.previous.total).gt(0)
      ? new Decimal(sales.current.total)
          .sub(sales.previous.total)
          .div(sales.previous.total)
          .mul(100)
      : null;
  const tiles: { label: string; value: string; detail: string; href: string }[] = [
    ...(sales
      ? [
          {
            label: "Sales this month (incl. tax)",
            value: formatMoney(sales.current.total),
            detail:
              salesChange === null
                ? `${sales.current.invoices} posted invoice${sales.current.invoices === 1 ? "" : "s"}`
                : `${salesChange.gte(0) ? "▲" : "▼"} ${salesChange.abs().toFixed(0)}% vs last month`,
            href: "/sales/invoices",
          },
        ]
      : []),
    ...(finance
      ? [
          {
            label: "Receivables",
            value: formatMoney(finance.receivables),
            detail: new Decimal(finance.customerAdvances).gt(0)
              ? `Owed by customers · advances received ${formatMoney(finance.customerAdvances)}`
              : "Owed by customers",
            href: "/accounting/receivables",
          },
          {
            label: "Payables",
            value: formatMoney(finance.payables),
            detail: new Decimal(finance.supplierAdvances).gt(0)
              ? `Owed to suppliers · advances paid ${formatMoney(finance.supplierAdvances)}`
              : "Owed to suppliers",
            href: "/accounting/payables",
          },
          {
            label: "Cash & bank",
            value: formatMoney(finance.cashAndBank),
            detail: "Across treasury accounts",
            href: "/accounting/cash-bank-accounts",
          },
          {
            label: "Stock value",
            value: formatMoney(finance.stockValue),
            detail: "Raw, packaging, WIP & finished",
            href: "/inventory/valuation",
          },
        ]
      : []),
    ...(production
      ? [
          {
            label: "Active batches",
            value: String(production.active.length),
            detail: `${production.completedThisMonth} completed this month`,
            href: "/production/batches",
          },
        ]
      : []),
  ];
  const hasSales = sales ? sales.monthly.some((month) => new Decimal(month.total).gt(0)) : false;

  return (
    <ResponsiveContainer>
      <PageHeader
        description={`Live figures for ${principal.name.split(" ")[0] ?? principal.name} — updated from posted records every time the page opens.`}
        title="Dashboard"
      />

      {tiles.length ? (
        <section
          aria-label="Key figures"
          className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6"
        >
          {tiles.map((tile) => (
            <Link className="group min-w-0" href={tile.href} key={tile.label}>
              <Card className="h-full p-4 transition-colors group-hover:border-[var(--accent)] group-focus-visible:border-[var(--accent)]">
                <p className="text-xs font-medium text-[var(--muted)]">{tile.label}</p>
                <p className="mt-3 break-words text-2xl font-bold tabular-nums tracking-[-0.02em] text-[var(--ink)]">
                  {tile.value}
                </p>
                <p className="mt-1 text-xs text-[var(--muted)]">{tile.detail}</p>
              </Card>
            </Link>
          ))}
        </section>
      ) : null}

      {pending.length ? (
        <Card className="mt-5 p-4 sm:p-5">
          <h2 className="text-sm font-semibold">Needs attention</h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {pending.map((entry) => (
              <li key={entry.label}>
                <Link
                  className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm hover:border-[var(--accent)]"
                  href={entry.href}
                >
                  <span>{entry.label}</span>
                  <StatusBadge tone={entry.count > 0 ? "warning" : "neutral"}>
                    {entry.count}
                  </StatusBadge>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {sales ? (
        <div className="mt-5 grid min-w-0 gap-5 xl:grid-cols-[1.4fr_1fr]">
          <Panel title="Sales by month" subtitle="Posted invoices, including tax · last 6 months">
            {hasSales ? (
              <BarChart
                caption="Sales by month"
                data={sales.monthly.map((month) => ({
                  key: month.month,
                  label: month.label,
                  value: Number(month.total),
                  detail: `${month.invoices} invoice${month.invoices === 1 ? "" : "s"}`,
                }))}
              />
            ) : (
              <Empty>No posted sales invoices yet. Post an invoice to see the trend.</Empty>
            )}
          </Panel>
          <Panel title="Top products this month" subtitle="Net sales value excluding tax">
            {sales.topProducts.length ? (
              <BarChart
                caption="Top products this month"
                data={sales.topProducts.map((product) => ({
                  key: product.code,
                  label: product.label,
                  value: Number(product.value),
                  detail: `${product.pieces} pieces`,
                }))}
                orientation="horizontal"
              />
            ) : (
              <Empty>No product sales this month yet.</Empty>
            )}
          </Panel>
        </div>
      ) : null}

      <div className="mt-5 grid min-w-0 gap-5 xl:grid-cols-2">
        {production ? (
          <Panel
            title="Production in progress"
            subtitle={`${production.planned} batch${production.planned === 1 ? "" : "es"} planned, not yet released`}
          >
            {production.active.length ? (
              <ul className="space-y-4">
                {production.active.map((batch) => (
                  <li key={batch.id}>
                    <Link className="block" href={`/production/batches/${batch.id}`}>
                      <div className="mb-1.5 flex justify-between gap-3 text-xs">
                        <span className="min-w-0 truncate">
                          <span className="font-mono font-semibold">{batch.batchNumber}</span>{" "}
                          <span className="text-[var(--muted)]">· {batch.product}</span>
                        </span>
                        <span className="shrink-0 tabular-nums text-[var(--muted)]">
                          {batch.produced} / {batch.planned} pcs
                        </span>
                      </div>
                      <div
                        aria-label={`${batch.percent}% of planned output`}
                        className="h-2 overflow-hidden rounded-full bg-[var(--skeleton)]"
                        role="img"
                      >
                        <div
                          className="h-full rounded-full bg-[var(--accent)]"
                          style={{ width: `${batch.percent}%` }}
                        />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No batches are released or in progress.</Empty>
            )}
          </Panel>
        ) : null}

        {stock ? (
          <Panel title="Stock alerts" subtitle="Items run out, and lots expiring within 30 days">
            {stock.outOfStock.length || stock.expiring.length ? (
              <ul className="divide-y divide-[var(--border)] text-sm">
                {stock.outOfStock.map((item) => (
                  <li className="flex items-center justify-between gap-3 py-2" key={item.id}>
                    <span className="min-w-0 truncate">
                      {item.name} <span className="text-xs text-[var(--muted)]">{item.code}</span>
                    </span>
                    <StatusBadge tone="warning">⚠ Out of stock</StatusBadge>
                  </li>
                ))}
                {stock.expiring.map((lot) => (
                  <li className="flex items-center justify-between gap-3 py-2" key={lot.id}>
                    <span className="min-w-0 truncate">
                      {lot.item}{" "}
                      <span className="text-xs text-[var(--muted)]">
                        lot {lot.lot} · {formatDocumentDate(lot.expiryDate)}
                      </span>
                    </span>
                    <StatusBadge tone="warning">
                      {lot.expired
                        ? "⚠ Expired"
                        : `⏱ ${lot.daysLeft} day${lot.daysLeft === 1 ? "" : "s"}`}
                    </StatusBadge>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No stock alerts. Everything in stock and in date.</Empty>
            )}
          </Panel>
        ) : null}
      </div>

      {activity ? (
        <Panel className="mt-5" title="Recent activity" subtitle="Latest recorded actions">
          {activity.length ? (
            <ul className="divide-y divide-[var(--border)] text-sm">
              {activity.map((event) => (
                <li
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2"
                  key={event.id}
                >
                  <span className="min-w-0">
                    {event.description}
                    {event.entityReference ? (
                      <span className="ml-1 font-mono text-xs text-[var(--muted)]">
                        {event.entityReference}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs text-[var(--muted)]">
                    {event.actor.name} · {relativeTime(event.occurredAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Nothing recorded yet.</Empty>
          )}
        </Panel>
      ) : null}
    </ResponsiveContainer>
  );
}

function Panel({
  title,
  subtitle,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={`min-w-0 p-4 sm:p-5 ${className}`}>
      <div className="mb-4">
        <h2 className="text-sm font-semibold">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs text-[var(--muted)]">{subtitle}</p> : null}
      </div>
      {children}
    </Card>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--muted)]">
      {children}
    </p>
  );
}

function relativeTime(value: Date) {
  const minutes = Math.round((Date.now() - value.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days < 7 ? `${days} d ago` : formatDocumentDate(value);
}
