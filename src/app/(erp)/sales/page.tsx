import { ModulePlaceholder } from "@/components/layout/module-placeholder";
import { requirePermission } from "@/server/auth/server-guards";
export default async function Page() {
  await requirePermission("sales.view");
  return (
    <ModulePlaceholder
      description="Future orders, dispatches, invoices, returns, customers, and sales-area workflows."
      moduleName="Sales"
    />
  );
}
