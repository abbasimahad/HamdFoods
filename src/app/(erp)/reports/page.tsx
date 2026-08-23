import { ModulePlaceholder } from "@/components/layout/module-placeholder";
import { requirePermission } from "@/server/auth/server-guards";
export default async function Page() {
  await requirePermission("reports.view");
  return (
    <ModulePlaceholder
      description="Future operational and financial reporting views."
      moduleName="Reports"
    />
  );
}
