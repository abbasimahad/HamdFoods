import { ManualJournalForm } from "@/components/accounting/accounting-management-forms";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { requirePermission } from "@/server/auth/server-guards";
import { prisma } from "@/server/db/prisma";
export default async function Page() {
  await requirePermission("accounting.manage");
  const accounts = await prisma.accountingAccount.findMany({ orderBy: { code: "asc" } });
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Manual Journal"
        description="Draft-to-posted journal entry. Control accounts are deliberately excluded."
      />
      <Card className="p-5">
        <ManualJournalForm accounts={accounts} />
      </Card>
    </ResponsiveContainer>
  );
}
