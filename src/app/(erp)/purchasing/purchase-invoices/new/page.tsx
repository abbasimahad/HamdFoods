import { PurchaseInvoiceForm } from "@/components/purchasing/purchase-invoice-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaPurchaseInvoiceRepository } from "@/server/purchasing/prisma-purchase-invoice-repository";
import { savePurchaseInvoiceAction } from "../actions";

export default async function NewPurchaseInvoicePage() {
  await requirePermission("purchasing.manage");
  const repository = new PrismaPurchaseInvoiceRepository();
  const [poLines, grnLines] = await Promise.all([
    repository.listEligiblePurchaseOrderLines(),
    repository.listEligibleGoodsReceiptLines(),
  ]);
  return (
    <ResponsiveContainer>
      <PageHeader
        title="New Purchase Invoice"
        description="Match a supplier invoice to purchase order lines and, where received, goods receipt lines."
      />
      <Card className="p-5">
        <PurchaseInvoiceForm
          action={savePurchaseInvoiceAction}
          poLines={poLines}
          grnLines={grnLines}
        />
      </Card>
    </ResponsiveContainer>
  );
}
