import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import type { PermissionCode } from "@/modules/access/domain/permissions";
import { hasPermission } from "@/modules/access/domain/principal";
import { requireAnyPermission } from "@/server/auth/server-guards";
import { prisma } from "@/server/db/prisma";

const sections: readonly {
  href: string;
  title: string;
  description: string;
  permission: PermissionCode;
}[] = [
  {
    href: "/administration/users",
    title: "Users",
    description: "Create staff accounts, assign roles, reset passwords and deactivate leavers.",
    permission: "users.view",
  },
  {
    href: "/administration/roles-permissions",
    title: "Roles & Permissions",
    description: "Decide what each role (Store Keeper, Accounts, Sales…) may view and change.",
    permission: "roles.manage",
  },
  {
    href: "/administration/settings",
    title: "Company Settings",
    description: "Company name, address and tax registration printed on every document.",
    permission: "settings.manage",
  },
  {
    href: "/administration/audit-log",
    title: "Audit Log",
    description: "Every posting, reversal and control change, with who did it and why.",
    permission: "audit.view",
  },
  {
    href: "/administration/license",
    title: "License",
    description: "Activation status and offline license import.",
    permission: "license.manage",
  },
  {
    href: "/administration/updates",
    title: "Software Updates",
    description: "Upload and install signed updates, and recover from a failed update.",
    permission: "updates.manage",
  },
];

export default async function Page() {
  const principal = await requireAnyPermission([
    "users.view",
    "users.manage",
    "roles.manage",
    "audit.view",
    "settings.manage",
    "license.manage",
    "updates.manage",
  ]);
  const [activeUsers, inactiveUsers] = hasPermission(principal, "users.view")
    ? await Promise.all([
        prisma.user.count({ where: { active: true } }),
        prisma.user.count({ where: { active: false } }),
      ])
    : [null, null];
  const visible = sections.filter((section) => hasPermission(principal, section.permission));
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Administration"
        description="People, access, company details, audit trail and system maintenance."
      />
      {activeUsers !== null ? (
        <p className="mb-4 text-sm text-[var(--muted)]">
          {activeUsers} active user{activeUsers === 1 ? "" : "s"}
          {inactiveUsers ? `, ${inactiveUsers} deactivated` : ""}.
        </p>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visible.map((section) => (
          <Link href={section.href} key={section.href}>
            <Card className="h-full p-5 transition-colors hover:border-[var(--accent)]">
              <h2 className="font-semibold text-[var(--accent)]">{section.title}</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">{section.description}</p>
            </Card>
          </Link>
        ))}
      </div>
    </ResponsiveContainer>
  );
}
