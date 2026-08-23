import { ModulePlaceholder } from "@/components/layout/module-placeholder";
import { requireAnyPermission } from "@/server/auth/server-guards";
export default async function Page() {
  await requireAnyPermission(["users.view", "users.manage", "roles.manage", "audit.view"]);
  return (
    <ModulePlaceholder
      description="Future user, role, permission, settings, and audit-log administration."
      moduleName="Administration"
    />
  );
}
