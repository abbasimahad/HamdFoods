import Link from "next/link";

import { SupplierForm } from "@/components/purchasing/supplier-form";
import { SupplierStatusForm } from "@/components/purchasing/supplier-status-form";
import { PageHeader } from "@/components/layout/page-header";
import { MasterSearch, SearchPagination } from "@/components/master-data/search-pagination";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { hasPermission } from "@/modules/access/domain/principal";
import { parsePurchasePage } from "@/modules/purchasing/application/listing";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaPurchasingRepository } from "@/server/purchasing/prisma-purchasing-repository";
import { saveSupplierAction, setSupplierStatusAction } from "./actions";

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const principal = await requirePermission("purchasing.view");
  const params = await searchParams;
  const query = params.q?.trim().slice(0, 120) ?? "";
  const result = await new PrismaPurchasingRepository().listSuppliers(
    query,
    parsePurchasePage(params.page),
  );
  const canManage = hasPermission(principal, "purchasing.manage");
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Suppliers"
        description="Maintain purchasing counterparties while retaining historical references."
      />
      {canManage && (
        <Card className="mb-5 p-5">
          <details>
            <summary className="cursor-pointer font-semibold">Create supplier</summary>
            <div className="mt-4">
              <SupplierForm action={saveSupplierAction} />
            </div>
          </details>
        </Card>
      )}
      <MasterSearch route="/purchasing/suppliers" defaultValue={query} />
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[65rem] text-left text-sm">
            <thead className="bg-[var(--surface)]">
              <tr>
                <th className="p-4">Code</th>
                <th className="p-4">Supplier</th>
                <th className="p-4">Contact</th>
                <th className="p-4">City</th>
                <th className="p-4">Terms</th>
                <th className="p-4">Status</th>
                <th className="p-4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {result.records.map((supplier) => (
                <tr key={supplier.id}>
                  <td className="p-4 font-mono text-xs">{supplier.code}</td>
                  <td className="p-4">
                    <Link
                      className="font-semibold text-[var(--accent)]"
                      href={`/purchasing/suppliers/${supplier.id}`}
                    >
                      {supplier.name}
                    </Link>
                    <span className="block text-xs text-[var(--muted)]">{supplier.email}</span>
                  </td>
                  <td className="p-4">
                    {supplier.contactPerson}
                    <span className="block text-xs text-[var(--muted)]">{supplier.phone}</span>
                  </td>
                  <td className="p-4">{supplier.city}</td>
                  <td className="p-4">
                    {supplier.paymentTermsDays === null ? "-" : `${supplier.paymentTermsDays} days`}
                  </td>
                  <td className="p-4">{supplier.active ? "Active" : "Inactive"}</td>
                  <td className="p-4">
                    {canManage && (
                      <SupplierStatusForm
                        action={setSupplierStatusAction}
                        id={supplier.id}
                        active={supplier.active}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <SearchPagination
          route="/purchasing/suppliers"
          query={query}
          page={result.page}
          pageCount={result.pageCount}
          total={result.total}
        />
      </Card>
    </ResponsiveContainer>
  );
}
