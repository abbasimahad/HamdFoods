import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { requirePermission } from "@/server/auth/server-guards";

export default async function ProductionPage() {
  await requirePermission("production.view");
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Production"
        description="Manufacturing master data and controlled, stock-neutral production planning."
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Link href="/production/recipes">
          <Card className="h-full p-5">
            <h2 className="font-semibold text-[var(--accent)]">Recipes & Packaging BOMs</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Versioned formulations, approval, recipe scaling, expected yield, and packaging
              requirements.
            </p>
          </Card>
        </Link>
        <Link href="/production/batches">
          <Card className="h-full p-5">
            <h2 className="font-semibold text-[var(--accent)]">Production Batches</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Scale approved recipes, snapshot requirements, review availability, and release plans
              without reserving or consuming stock.
            </p>
          </Card>
        </Link>
      </div>
    </ResponsiveContainer>
  );
}
