import { ModulePlaceholder } from "@/components/layout/module-placeholder";
import { requirePermission } from "@/server/auth/server-guards";
export default async function Page() {
  await requirePermission("accounting.view");
  return (
    <ModulePlaceholder
      description="Future receivables, payables, expenses, journals, and general-ledger workflows."
      moduleName="Accounting"
    />
  );
}
