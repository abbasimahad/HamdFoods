import { PageHeader } from "@/components/layout/page-header";
import { CartonCalculatorForm } from "@/components/quantity/carton-calculator-form";
import { UnitConversionForm } from "@/components/quantity/unit-conversion-form";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { calculateQuantityQuery } from "@/modules/quantity/application/calculate-quantity";
import type { QuantityCalculatorResult } from "@/modules/quantity/application/contracts";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaQuantityCatalog } from "@/server/quantity/prisma-quantity-catalog";

type CalculatorSearchParams = Record<string, string | string[] | undefined>;

export default async function QuantityCalculatorPage({
  searchParams,
}: {
  searchParams: Promise<CalculatorSearchParams>;
}) {
  await requirePermission("inventory.view");
  const rawQuery = await searchParams;
  const catalog = new PrismaQuantityCatalog();
  const [units, finishedGoods, result] = await Promise.all([
    catalog.listActiveSupportedUnits(),
    catalog.listActiveFinishedGoods(),
    calculateQuantityQuery(rawQuery, catalog),
  ]);
  const values = scalarValues(rawQuery);

  return (
    <ResponsiveContainer>
      <PageHeader
        description="Verify exact supported-unit and finished-good carton calculations. Calculator entries are never saved and do not represent stock."
        title="Quantity Calculator"
      />
      <div className="space-y-5">
        <Card className="p-5">
          <h2 className="font-semibold">Unit conversion</h2>
          <p className="mb-4 mt-1 text-sm leading-6 text-[var(--muted)]">
            Convert between kg and g, L and ml, or normalize pieces within the same dimension.
          </p>
          <UnitConversionForm units={units} values={values} />
        </Card>
        <Card className="p-5">
          <h2 className="font-semibold">Carton conversion</h2>
          <p className="mb-4 mt-1 text-sm leading-6 text-[var(--muted)]">
            Normalize cartons and loose pieces, then derive total pieces and product content from
            the finished-good profile.
          </p>
          {finishedGoods.length > 0 ? (
            <CartonCalculatorForm finishedGoods={finishedGoods} values={values} />
          ) : (
            <p className="text-sm text-[var(--warning-ink)]">
              Create an active finished good with a valid profile before using this calculator.
            </p>
          )}
        </Card>
        <CalculatorResult result={result} />
      </div>
    </ResponsiveContainer>
  );
}

function CalculatorResult({ result }: { result: QuantityCalculatorResult }) {
  if (result.kind === "idle") return null;
  if (result.kind === "error") {
    return (
      <Card className="border-[var(--danger)] p-5" aria-live="polite">
        <h2 className="font-semibold text-[var(--danger)]">Calculation unavailable</h2>
        <p className="mt-2 text-sm">{result.message}</p>
      </Card>
    );
  }
  if (result.kind === "unit") {
    return (
      <Card className="p-5" aria-live="polite">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          Conversion result
        </p>
        <p className="mt-2 text-2xl font-semibold">
          {result.inputText} = {result.resultText}
        </p>
      </Card>
    );
  }
  return (
    <Card className="p-5" aria-live="polite">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
        Carton result
      </p>
      <h2 className="mt-2 text-lg font-semibold">{result.productName}</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">{result.productDefinition}</p>
      <dl className="mt-4 grid gap-4 sm:grid-cols-3">
        <ResultValue label="Normalized packs" value={result.normalizedBreakdown} />
        <ResultValue label="Total pieces" value={`${result.totalPieces} pcs`} />
        <ResultValue label="Total product content" value={result.totalContent} />
      </dl>
    </Card>
  );
}

function ResultValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-[var(--muted)]">{label}</dt>
      <dd className="mt-1 font-semibold">{value}</dd>
    </div>
  );
}

function scalarValues(query: CalculatorSearchParams): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(query).map(([key, value]) => [
      key,
      typeof value === "string" ? value : undefined,
    ]),
  );
}
