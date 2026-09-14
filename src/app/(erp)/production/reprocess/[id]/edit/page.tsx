import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { ReprocessDraftEditForm } from "@/components/production/reprocess-draft-edit-form";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaReprocessRepository } from "@/server/production/prisma-reprocess-repository";
import { updateReprocessDraftAction } from "../../actions";

export default async function EditReprocessPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("production.manage");
  const document = await new PrismaReprocessRepository().getDocument((await params).id);
  if (!document) notFound();
  if (document.status !== "DRAFT") redirect(`/production/reprocess/${document.id}`);
  return (
    <ResponsiveContainer>
      <PageHeader
        title={`Edit ${document.documentNumber}`}
        description="Correct draft reason and notes without changing frozen source genealogy or the linked production plan."
      />
      <Card className="p-5">
        <ReprocessDraftEditForm
          action={updateReprocessDraftAction}
          id={document.id}
          notes={document.notes ?? ""}
          reason={document.reason}
        />
      </Card>
    </ResponsiveContainer>
  );
}
