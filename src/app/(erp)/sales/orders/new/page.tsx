import { SalesOrderForm } from "@/components/sales/sales-order-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { requirePermission } from "@/server/auth/server-guards";
import { hasPermission } from "@/modules/access/domain/principal";
import { PrismaMasterDataRepository } from "@/server/master-data/prisma-master-data-repository";
import { PrismaSalesRepository } from "@/server/sales/prisma-sales-repository";
import { PrismaSalesOrderRepository } from "@/server/sales/prisma-sales-order-repository";
import { saveSalesOrderAction } from "../actions";
export default async function NewSalesOrderPage() {
  const principal = await requirePermission("sales.manage");
  const repository = new PrismaSalesOrderRepository();
  const salesRepository = new PrismaSalesRepository();
  const masterRepository = new PrismaMasterDataRepository();
  const canCreateProduct = hasPermission(principal, "inventory.manage");
  const [references, salesReferences, categories, units] = await Promise.all([
    repository.getSalesOrderReferences(),
    salesRepository.getReferenceData(true),
    canCreateProduct ? masterRepository.listActiveCategories("FINISHED_GOOD") : [],
    canCreateProduct ? masterRepository.listActiveUnits() : [],
  ]);
  return (
    <ResponsiveContainer>
      <PageHeader
        title="New Sales Order"
        description="Create a draft. Approval later reserves AVAILABLE finished-goods stock."
      />
      <Card className="p-5">
        <SalesOrderForm
          action={saveSalesOrderAction}
          quickCreateReferences={{
            groups: salesReferences.groups,
            areas: salesReferences.areas,
            routes: salesReferences.routes,
            salespersons: salesReferences.salespersons,
            ...(canCreateProduct ? { categories, units } : {}),
          }}
          references={references}
        />
      </Card>
    </ResponsiveContainer>
  );
}
