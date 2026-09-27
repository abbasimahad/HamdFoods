import Link from "next/link";
import { FinancialReportControls } from "@/components/accounting/financial-report-controls";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { formatDocumentDate, formatMoney } from "@/components/ui/format-money";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { reportRange, salesTaxReport } from "@/server/accounting/financial-reporting";
import { requireAnyPermission } from "@/server/auth/server-guards";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requireAnyPermission(["accounting.view", "reports.view"]);
  const q = await searchParams;
  const range = reportRange(q.from, q.to);
  const report = await salesTaxReport(range);
  const summary: readonly [string, string][] = [
    ["Output tax charged on sales", report.totals.outputOnSales],
    ["Less output tax reversed (returns)", report.totals.outputReversed],
    ["Net output tax", report.totals.netOutput],
    ["Less input tax on purchases", report.totals.inputTax],
    ["Net sales tax payable / (refundable)", report.totals.netPayable],
  ];
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Sales Tax Report"
        description="Output and input tax from the posted ledger, with the sales invoice register. Confirm filing requirements with your tax adviser."
      />
      <FinancialReportControls
        from={range.from.toISOString().slice(0, 10)}
        to={range.to.toISOString().slice(0, 10)}
      />
      <div className="mb-4 grid gap-4 lg:grid-cols-[1fr_2fr]">
        <Card className="p-5">
          <h2 className="mb-3 font-semibold">Summary</h2>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm">
            {summary.map(([label, value], index) => (
              <div className="contents" key={label}>
                <dt className={index === summary.length - 1 ? "border-t pt-2 font-semibold" : ""}>
                  {label}
                </dt>
                <dd
                  className={`text-right tabular-nums ${index === summary.length - 1 ? "border-t pt-2 font-semibold" : ""}`}
                >
                  {formatMoney(value)}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-xs text-[var(--muted)]">
            {report.totals.invoiceCount} posted invoices, value excluding tax{" "}
            {formatMoney(report.totals.valueExclTax)}; {report.totals.registeredBuyerCount}{" "}
            registered buyers.
          </p>
        </Card>
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[42rem] text-sm">
              <thead className="bg-[var(--surface)]">
                <tr>
                  <th className="p-3 text-left">Invoice</th>
                  <th className="p-3 text-left">Date</th>
                  <th className="p-3 text-left">Buyer</th>
                  <th className="p-3 text-left">Buyer NTN / STRN</th>
                  <th className="p-3 text-right">Value excl. tax</th>
                  <th className="p-3 text-right">Sales tax</th>
                  <th className="p-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {report.register.length ? (
                  report.register.map((row) => (
                    <tr key={row.id}>
                      <td className="p-3">
                        <Link className="text-[var(--accent)]" href={`/sales/invoices/${row.id}`}>
                          {row.number}
                        </Link>
                      </td>
                      <td className="p-3">{formatDocumentDate(row.invoiceDate)}</td>
                      <td className="p-3">{row.customerName}</td>
                      <td className="p-3">{row.customerTaxRegistrationNo ?? "Unregistered"}</td>
                      <td className="p-3 text-right tabular-nums">
                        {formatMoney(row.valueExclTax, "")}
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        {formatMoney(row.taxTotal, "")}
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        {formatMoney(row.grandTotal, "")}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="p-6 text-center text-[var(--muted)]" colSpan={7}>
                      No posted sales invoices in this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </ResponsiveContainer>
  );
}
