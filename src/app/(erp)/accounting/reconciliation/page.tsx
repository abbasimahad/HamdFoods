import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { requirePermission } from "@/server/auth/server-guards";
import { reconciliation } from "@/server/accounting/prisma-accounting-repository";
export default async function Page() {
  await requirePermission("accounting.view");
  const rows = await reconciliation();
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Control-Account Reconciliation"
        description="Control-ledger and treasury-to-GL differences are shown explicitly and are never repaired automatically."
      />
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="p-3 text-left">Control</th>
              <th className="p-3 text-left">GL</th>
              <th className="p-3 text-left">Authoritative source / linked GL ledger</th>
              <th className="p-3 text-left">Difference</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => (
              <tr key={row.name}>
                <td className="p-3">{row.name}</td>
                <td className="p-3">{row.gl.toFixed(6)}</td>
                <td className="p-3">{row.comparable ? row.source.toFixed(6) : "Reference only"}</td>
                <td className="p-3">{row.comparable ? row.difference.toFixed(6) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </ResponsiveContainer>
  );
}
