import Link from "next/link";

import type {
  SubledgerPartyDetail,
  SubledgerPartySummary,
} from "@/modules/accounting/application/subledger-workbench-contracts";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

export function SubledgerList({
  rows,
  basePath,
}: {
  rows: readonly SubledgerPartySummary[];
  basePath: string;
}) {
  if (!rows.length)
    return (
      <EmptyState
        title="No balances found"
        description="Try a different customer or supplier search."
      />
    );
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[64rem] text-left text-sm">
        <thead>
          <tr>
            <th className="p-3">Account</th>
            <th className="p-3">Outstanding</th>
            <th className="p-3">Credits / advances</th>
            <th className="p-3">Net balance</th>
            <th className="p-3">Current</th>
            <th className="p-3">1–30</th>
            <th className="p-3">31–60</th>
            <th className="p-3">61–90</th>
            <th className="p-3">90+</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => (
            <tr key={row.partyId}>
              <td className="p-3">
                <Link
                  className="font-semibold text-[var(--accent)]"
                  href={`${basePath}/${row.partyId}`}
                >
                  {row.code} · {row.name}
                </Link>
              </td>
              <td className="p-3">{row.outstandingBalance}</td>
              <td className="p-3">{row.creditsAvailable}</td>
              <td className="p-3 font-semibold">{row.netBalance}</td>
              <td className="p-3">{row.aging.current}</td>
              <td className="p-3">{row.aging.days1To30}</td>
              <td className="p-3">{row.aging.days31To60}</td>
              <td className="p-3">{row.aging.days61To90}</td>
              <td className="p-3">{row.aging.days90Plus}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export function SubledgerDetail({ detail }: { detail: SubledgerPartyDetail }) {
  const metrics = [
    ["Outstanding", detail.outstandingBalance],
    ["Credits / advances", detail.creditsAvailable],
    ["Net balance", detail.netBalance],
    ["Overdue", overdue(detail)],
  ];
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(([label, value]) => (
          <Card className="p-4" key={label}>
            <p className="text-sm text-[var(--muted)]">{label}</p>
            <p className="mt-1 text-xl font-semibold">{value}</p>
          </Card>
        ))}
      </div>
      <Card className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[48rem] text-left text-sm">
          <thead>
            <tr>
              <th className="p-3">Date</th>
              <th className="p-3">Type</th>
              <th className="p-3">Document</th>
              <th className="p-3">Description</th>
              <th className="p-3">Debit</th>
              <th className="p-3">Credit</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {detail.history.map((row) => (
              <tr key={`${row.type}-${row.id}`}>
                <td className="p-3">{row.date.toISOString().slice(0, 10)}</td>
                <td className="p-3">{row.type}</td>
                <td className="p-3">{historyLink(row.type, row.id, row.number)}</td>
                <td className="p-3">{row.description}</td>
                <td className="p-3">{row.debit}</td>
                <td className="p-3">{row.credit}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!detail.history.length ? (
          <p className="p-5 text-sm text-[var(--muted)]">No activity through this date.</p>
        ) : null}
      </Card>
    </>
  );
}

function overdue(detail: SubledgerPartyDetail) {
  const values = [
    detail.aging.days1To30,
    detail.aging.days31To60,
    detail.aging.days61To90,
    detail.aging.days90Plus,
  ];
  return values.reduce((sum, value) => sum + Number(value), 0).toFixed(6);
}

function historyLink(type: string, id: string, number: string) {
  const path = type.includes("CUSTOMER_PAYMENT")
    ? `/sales/payments/${id}`
    : type.includes("SUPPLIER_PAYMENT")
      ? `/purchasing/supplier-payments/${id}`
      : type.includes("INVOICE") && !type.includes("PURCHASE")
        ? `/sales/invoices/${id}`
        : type.includes("RETURN") && !type.includes("PURCHASE")
          ? `/sales/returns/${id}`
          : type.includes("GOODS_RECEIPT")
            ? `/purchasing/goods-receiving/${id}`
            : type.includes("PURCHASE_RETURN")
              ? `/purchasing/purchase-returns/${id}`
              : null;
  return path ? (
    <Link className="text-[var(--accent)]" href={path}>
      {number}
    </Link>
  ) : (
    number
  );
}
