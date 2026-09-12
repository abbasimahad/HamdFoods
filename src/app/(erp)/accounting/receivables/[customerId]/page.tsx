import Link from "next/link";
import { notFound } from "next/navigation";
import { SubledgerDetail } from "@/components/accounting/subledger-workbench";
import { PageHeader } from "@/components/layout/page-header";
import { PageActions, primaryPageActionClass } from "@/components/ui/page-actions";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { hasPermission } from "@/modules/access/domain/principal";
import { PrismaSubledgerWorkbench } from "@/server/accounting/prisma-subledger-workbench";
import { requirePermission } from "@/server/auth/server-guards";
export default async function Page({ params }: { params: Promise<{ customerId: string }> }) {
  const principal = await requirePermission("accounting.view");
  const { customerId } = await params;
  const detail = await new PrismaSubledgerWorkbench().getReceivable(customerId, new Date());
  if (!detail) notFound();
  const returnTo = `/accounting/receivables/${customerId}`;
  return (
    <ResponsiveContainer>
      <PageHeader
        title={`${detail.code} · ${detail.name}`}
        description="Customer receivable balance and allocation history."
        actions={
          hasPermission(principal, "sales.manage") ? (
            <PageActions>
              <Link
                className={primaryPageActionClass}
                href={`/sales/payments/new?customer=${customerId}&returnTo=${encodeURIComponent(returnTo)}`}
              >
                + New Customer Payment
              </Link>
            </PageActions>
          ) : null
        }
      />
      <SubledgerDetail detail={detail} />
    </ResponsiveContainer>
  );
}
