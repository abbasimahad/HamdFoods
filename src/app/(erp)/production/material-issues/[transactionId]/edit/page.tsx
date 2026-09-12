import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaProductionMaterialRepository } from "@/server/production/prisma-production-material-repository";
export default async function Page({ params }: { params: Promise<{ transactionId: string }> }) {
  await requirePermission("production.manage");
  const tx = await new PrismaProductionMaterialRepository().getTransaction(
    (await params).transactionId,
  );
  if (!tx) notFound();
  redirect(`/production/batches/${tx.productionBatchId}/materials/${tx.id}/edit`);
}
