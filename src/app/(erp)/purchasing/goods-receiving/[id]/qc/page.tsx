import { notFound, redirect } from "next/navigation";
import { GoodsReceiptQcForm } from "@/components/purchasing/goods-receipt-qc-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaGoodsReceiptRepository } from "@/server/purchasing/prisma-goods-receipt-repository";
import { completeGoodsReceiptQcAction } from "../../actions";
export default async function GoodsReceiptQcPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("purchasing.manage");
  const receipt = await new PrismaGoodsReceiptRepository().getGoodsReceipt((await params).id);
  if (!receipt) notFound();
  if (receipt.status !== "POSTED") redirect(`/purchasing/goods-receiving/${receipt.id}`);
  return (
    <ResponsiveContainer>
      <PageHeader
        title={`Purchase QC - ${receipt.number}`}
        description="Classify every received lot exactly into available or quarantine inventory."
      />
      <Card className="p-5">
        <GoodsReceiptQcForm action={completeGoodsReceiptQcAction} receipt={receipt} />
      </Card>
    </ResponsiveContainer>
  );
}
