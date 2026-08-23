import { UserCreateForm } from "@/components/access/user-create-form";
import { UserRoleForm } from "@/components/access/user-role-form";
import { UserStatusForm } from "@/components/access/user-status-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { hasPermission } from "@/modules/access/domain/principal";
import { PrismaAccessRepository } from "@/server/access/prisma-access-repository";
import { requirePermission } from "@/server/auth/server-guards";

export default async function UsersPage() {
  const principal = await requirePermission("users.view");
  const repository = new PrismaAccessRepository();
  const [users, roleRows] = await Promise.all([repository.listUsers(), repository.listRoles()]);
  const roles = roleRows.map(({ code, name }) => ({ code, name }));
  const canManage = hasPermission(principal, "users.manage");
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Users"
        description="Create accounts, assign database-backed roles, and control access."
      />
      {canManage && (
        <Card className="mb-5 p-5">
          <h2 className="mb-4 font-semibold">Create user</h2>
          <UserCreateForm roles={roles} />
        </Card>
      )}
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[58rem] text-left text-sm">
          <thead className="bg-[var(--surface)]">
            <tr>
              <th className="p-4">User</th>
              <th className="p-4">Status</th>
              <th className="p-4">Roles</th>
              <th className="p-4">Access</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {users.map((user) => {
              const assigned = user.roles.map(({ role }) => role.code);
              return (
                <tr key={user.id}>
                  <td className="p-4">
                    <strong className="block">{user.name}</strong>
                    <span className="text-xs text-[var(--muted)]">{user.email}</span>
                  </td>
                  <td className="p-4">{user.active ? "Active" : "Inactive"}</td>
                  <td className="p-4">
                    {canManage ? (
                      <UserRoleForm assigned={assigned} roles={roles} userId={user.id} />
                    ) : (
                      assigned.join(", ")
                    )}
                  </td>
                  <td className="p-4">
                    {canManage && <UserStatusForm active={user.active} userId={user.id} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </ResponsiveContainer>
  );
}
