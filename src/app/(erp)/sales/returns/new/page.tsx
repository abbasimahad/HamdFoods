import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { SalesReturnForm } from "@/components/sales/sales-return-form";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaSalesReturnRepository } from "@/server/sales/prisma-sales-return-repository";
import { saveSalesReturnAction } from "../actions";
type Params = { type?: "INVOICED_RETURN" | "DISPATCH_REFUSAL"; source?: string; dispatch?: string };
export default async function NewSalesReturnPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  await requirePermission("sales.manage");
  const params = await searchParams;
  const repository = new PrismaSalesReturnRepository();
  const references = await repository.getSalesReturnReferences();
  const type = params.type === "DISPATCH_REFUSAL" ? "DISPATCH_REFUSAL" : "INVOICED_RETURN";
  const [invoiceId, selectedDispatchId] = params.source?.split("|") ?? [];
  const source = params.source
    ? type === "INVOICED_RETURN"
      ? await repository.getInvoicedReturnSource(
          invoiceId ?? params.source!,
          selectedDispatchId ?? params.dispatch,
        )
      : await repository.getDispatchRefusalSource(params.source)
    : null;
  return (
    <ResponsiveContainer>
      <PageHeader
        title="New Sales Return"
        description="Choose an invoiced source for a customer credit, or an uninvoiced dispatch for physical refusal only."
      />
      <Card className="mb-4 p-5">
        <form className="grid gap-3 md:grid-cols-3">
          <select className="min-h-11 rounded border bg-white p-2" defaultValue={type} name="type">
            <option value="INVOICED_RETURN">Invoiced return</option>
            <option value="DISPATCH_REFUSAL">Dispatch refusal before invoice</option>
          </select>
          <select
            className="min-h-11 rounded border bg-white p-2"
            defaultValue={params.source ?? ""}
            name="source"
          >
            <option value="">Select source</option>
            {type === "INVOICED_RETURN"
              ? references.invoices.map((invoice) => (
                  <option key={invoice.id} value={invoice.id}>
                    {invoice.number} — {invoice.customerName}
                  </option>
                ))
              : references.dispatches.map((dispatch) => (
                  <option key={dispatch.id} value={dispatch.id}>
                    {dispatch.number} — {dispatch.customerName}
                  </option>
                ))}
          </select>
          {type === "INVOICED_RETURN" && (
            <select
              className="min-h-11 rounded border bg-white p-2"
              defaultValue={params.dispatch ?? ""}
              name="dispatch"
            >
              <option value="">Source dispatch (required when invoice spans dispatches)</option>
              {references.dispatches.map((dispatch) => (
                <option key={dispatch.id} value={dispatch.id}>
                  {dispatch.number}
                </option>
              ))}
            </select>
          )}
          <button className="rounded bg-[var(--accent)] px-4 text-sm font-semibold text-white">
            Load source
          </button>
        </form>
        {type === "INVOICED_RETURN" && params.source && !params.dispatch && (
          <p className="mt-3 text-sm">
            If this invoice contains multiple dispatches, add{" "}
            <code>?type=INVOICED_RETURN&amp;source=…&amp;dispatch=…</code> using the matching
            dispatch ID.
          </p>
        )}
      </Card>
      {source ? (
        <Card className="p-5">
          <SalesReturnForm action={saveSalesReturnAction} references={references} source={source} />
        </Card>
      ) : (
        <Card className="p-5 text-sm text-[var(--muted-foreground)]">
          Select a source to see only its eligible, lot-traceable quantities.
        </Card>
      )}
    </ResponsiveContainer>
  );
}
