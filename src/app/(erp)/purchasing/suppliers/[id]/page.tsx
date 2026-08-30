import { notFound } from "next/navigation";
import Link from "next/link";
import { SupplierForm } from "@/components/purchasing/supplier-form";
import { SupplierStatusForm } from "@/components/purchasing/supplier-status-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { hasPermission } from "@/modules/access/domain/principal";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaPurchasingRepository } from "@/server/purchasing/prisma-purchasing-repository";
import { PrismaPurchaseReturnRepository } from "@/server/purchasing/prisma-purchase-return-repository";
import { prisma } from "@/server/db/prisma";
import { saveSupplierAction, setSupplierStatusAction } from "../actions";

export default async function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePermission("purchasing.view");
  const id = (await params).id;
  const canViewAccounting = hasPermission(principal, "accounting.view");
  const [supplier, returns, payableEntries] = await Promise.all([
    new PrismaPurchasingRepository().getSupplier(id),
    new PrismaPurchaseReturnRepository().listPurchaseReturns({
      page: 1,
      query: "",
      supplierId: id,
    }),
    canViewAccounting
      ? prisma.supplierPayableLedgerEntry.findMany({
          where: { supplierId: id },
          orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
          take: 100,
        })
      : Promise.resolve([]),
  ]);
  if (!supplier) notFound();
  const canManage = hasPermission(principal, "purchasing.manage");
  return (
    <ResponsiveContainer>
      <PageHeader
        title={`${supplier.code} - ${supplier.name}`}
        description={`${supplier.active ? "Active" : "Inactive"} supplier details`}
      />
      <Card className="mb-5 grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-3">
        <Info label="Contact" value={supplier.contactPerson} />
        <Info
          label="Phone"
          value={[supplier.phone, supplier.secondaryPhone].filter(Boolean).join(" / ")}
        />
        <Info label="Email" value={supplier.email} />
        <Info label="City" value={supplier.city} />
        <Info label="Tax / registration" value={supplier.taxRegistrationNo ?? "-"} />
        <Info
          label="Payment terms"
          value={supplier.paymentTermsDays === null ? "-" : `${supplier.paymentTermsDays} days`}
        />
        <Info label="Address" value={supplier.address} />
        <Info label="Notes" value={supplier.notes ?? "-"} />
        {canManage && (
          <SupplierStatusForm
            action={setSupplierStatusAction}
            id={supplier.id}
            active={supplier.active}
          />
        )}
      </Card>
      {canViewAccounting ? (
        <p className="mb-5">
          <Link
            className="font-semibold text-[var(--accent)]"
            href={`/purchasing/suppliers/${supplier.id}/statement`}
          >
            View supplier payable statement
          </Link>
        </p>
      ) : null}
      {canViewAccounting ? (
        <Card className="mb-5 overflow-hidden">
          <div className="p-5">
            <h2 className="font-semibold">Supplier payable statement</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Balance is derived from posted supplier-payable entries.
            </p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="p-3 text-left">Date</th>
                <th className="p-3 text-left">Reference</th>
                <th className="p-3 text-left">Type</th>
                <th className="p-3 text-left">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {payableEntries.map((entry) => (
                <tr key={entry.id}>
                  <td className="p-3">{entry.entryDate.toISOString().slice(0, 10)}</td>
                  <td className="p-3">{entry.sourceNumber ?? entry.sourceId}</td>
                  <td className="p-3">{entry.entryType.replaceAll("_", " ")}</td>
                  <td className="p-3">{entry.signedAmount.toString()}</td>
                </tr>
              ))}
              {!payableEntries.length ? (
                <tr>
                  <td className="p-3 text-[var(--muted)]" colSpan={4}>
                    No supplier-payable entries.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </Card>
      ) : null}
      <Card className="mb-5 p-5">
        <h2 className="font-semibold">Purchase returns and replacement obligations</h2>
        {returns.records.length ? (
          <div className="mt-3 space-y-2">
            {returns.records.map((record) => (
              <div
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"
                key={record.id}
              >
                <div>
                  <Link
                    className="font-mono font-semibold text-[var(--accent)]"
                    href={`/purchasing/purchase-returns/${record.id}`}
                  >
                    {record.number}
                  </Link>
                  <span className="ml-3">
                    {record.purchaseOrderNumber} / {record.originalGoodsReceiptNumber}
                  </span>
                </div>
                <span>
                  {record.status.replaceAll("_", " ")} - outstanding{" "}
                  {record.lines.map((line) => line.replacementRemainingQuantity).join(" + ")}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-[var(--muted)]">No purchase returns for this supplier.</p>
        )}
      </Card>
      {canManage && (
        <Card className="p-5">
          <h2 className="mb-4 font-semibold">Edit supplier</h2>
          <SupplierForm action={saveSupplierAction} initial={supplier} />
        </Card>
      )}
    </ResponsiveContainer>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-[var(--muted)]">{label}</dt>
      <dd className="mt-1 text-sm">{value}</dd>
    </div>
  );
}
