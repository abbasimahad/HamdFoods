import Link from "next/link";
import type { ProductionTransactionSummary } from "@/modules/production/application/transaction-workbench-contracts";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
export function TransactionWorkbenchList({
  rows,
  base,
}: {
  rows: readonly ProductionTransactionSummary[];
  base: string;
}) {
  if (!rows.length)
    return (
      <EmptyState
        title="No transactions found"
        description="Create a draft for an eligible production batch."
      />
    );
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[50rem] text-left text-sm">
        <thead>
          <tr>
            <th className="p-3">Transaction</th>
            <th className="p-3">Batch</th>
            <th className="p-3">Product</th>
            <th className="p-3">Date</th>
            <th className="p-3">Type</th>
            <th className="p-3">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="p-3">
                <Link className="text-[var(--accent)]" href={`${base}/${row.id}`}>
                  {row.number}
                </Link>
              </td>
              <td className="p-3">
                <Link href={`/production/batches/${row.batchId}`}>{row.batchNumber}</Link>
              </td>
              <td className="p-3">{row.product}</td>
              <td className="p-3">{row.date.toISOString().slice(0, 10)}</td>
              <td className="p-3">{row.type}</td>
              <td className="p-3">{row.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
