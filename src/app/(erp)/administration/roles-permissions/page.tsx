import { RolePermissionForm } from "@/components/access/role-permission-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { PrismaAccessRepository } from "@/server/access/prisma-access-repository";
import { requirePermission } from "@/server/auth/server-guards";

export default async function RolesPermissionsPage() {
  await requirePermission("roles.manage");
  const roles = await new PrismaAccessRepository().listRoles();
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Roles & Permissions"
        description="Edit module-level permissions for seeded ERP roles."
      />
      <div className="space-y-5">
        {roles.map((role) => (
          <Card className="p-5" key={role.code}>
            <div className="mb-4">
              <h2 className="font-semibold">{role.name}</h2>
              <p className="text-xs text-[var(--muted)]">{role.code}</p>
            </div>
            <RolePermissionForm
              assigned={role.permissions.map(({ permission }) => permission.code)}
              protectedRole={role.code === "SUPER_ADMIN"}
              roleCode={role.code}
            />
          </Card>
        ))}
      </div>
    </ResponsiveContainer>
  );
}
