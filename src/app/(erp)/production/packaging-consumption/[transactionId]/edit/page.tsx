import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaProductionPackagingRepository } from "@/server/production/prisma-production-packaging-repository";
export default async function Page({ params }: { params: Promise<{ transactionId: string }> }) {
  await requirePermission("production.manage");
  const tx = await new PrismaProductionPackagingRepository().getTransaction(
    (await params).transactionId,
  );
  if (!tx) notFound();
  redirect(`/production/batches/${tx.productionBatchId}/packaging/${tx.id}/edit`);
}
