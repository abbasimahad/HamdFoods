import Link from "next/link";
import { notFound } from "next/navigation";
import { endOfFactoryLocalDay } from "@/server/shared/factory-local-time";
import { SubledgerDetail } from "@/components/accounting/subledger-workbench";
import { PageHeader } from "@/components/layout/page-header";
import { PageActions, primaryPageActionClass } from "@/components/ui/page-actions";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { hasPermission } from "@/modules/access/domain/principal";
import { PrismaSubledgerWorkbench } from "@/server/accounting/prisma-subledger-workbench";
import { requirePermission } from "@/server/auth/server-guards";
export default async function Page({ params }: { params: Promise<{ supplierId: string }> }) {
  const principal = await requirePermission("accounting.view");
  const { supplierId } = await params;
  const detail = await new PrismaSubledgerWorkbench().getPayable(
    supplierId,
    endOfFactoryLocalDay(),
  );
  if (!detail) notFound();
  const returnTo = `/accounting/payables/${supplierId}`;
  return (
    <ResponsiveContainer>
      <PageHeader
        title={`${detail.code} · ${detail.name}`}
        description="Supplier payable balance and allocation history."
        actions={
          hasPermission(principal, "accounting.manage") ? (
            <PageActions>
              <Link
                className={primaryPageActionClass}
                href={`/purchasing/supplier-payments/new?supplier=${supplierId}&returnTo=${encodeURIComponent(returnTo)}`}
              >
                + New Supplier Payment
              </Link>
            </PageActions>
          ) : null
        }
      />
      <SubledgerDetail detail={detail} />
    </ResponsiveContainer>
  );
}
