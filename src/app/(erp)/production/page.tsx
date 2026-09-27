import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import type { PermissionCode } from "@/modules/access/domain/permissions";
import { hasPermission } from "@/modules/access/domain/principal";
import { requireAnyPermission } from "@/server/auth/server-guards";

const sections: readonly {
  href: string;
  title: string;
  description: string;
  permissions: readonly PermissionCode[];
}[] = [
  {
    href: "/production/recipes",
    title: "Recipes & Packaging BOMs",
    description:
      "Versioned formulations, approval, recipe scaling, expected yield, and packaging requirements.",
    permissions: ["production.view"],
  },
  {
    href: "/production/batches",
    title: "Production Batches",
    description:
      "Scale approved recipes, issue materials and packaging, record output, and finalize costing.",
    permissions: ["production.view"],
  },
  {
    href: "/production/reprocess",
    title: "Reprocess",
    description: "Rework returned or held finished goods with an independent QC release.",
    permissions: ["production.view", "quality.manage"],
  },
  {
    href: "/production/waste-damage",
    title: "Waste & Damage",
    description: "Write off damaged or expired stock by lot, with the loss posted to the ledger.",
    permissions: ["waste.manage", "inventory.manage", "production.view"],
  },
];

export default async function ProductionPage() {
  const principal = await requireAnyPermission([
    "production.view",
    "quality.manage",
    "waste.manage",
    "inventory.manage",
  ]);
  const visible = sections.filter((section) =>
    section.permissions.some((permission) => hasPermission(principal, permission)),
  );
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Production"
        description="Recipes, batches, reprocessing and waste for the factory floor."
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visible.map((section) => (
          <Link href={section.href} key={section.href}>
            <Card className="h-full p-5">
              <h2 className="font-semibold text-[var(--accent)]">{section.title}</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">{section.description}</p>
            </Card>
          </Link>
        ))}
      </div>
    </ResponsiveContainer>
  );
}
