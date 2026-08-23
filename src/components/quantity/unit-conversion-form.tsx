import type { QuantityUnitRecord } from "@/modules/quantity/application/contracts";

export function UnitConversionForm({
  units,
  values,
}: {
  units: readonly QuantityUnitRecord[];
  values: { quantity?: string; fromUnitId?: string; toUnitId?: string };
}) {
  return (
    <form className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" method="get">
      <input name="calculation" type="hidden" value="unit" />
      <label className="text-sm font-medium">
        Quantity
        <input
          className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] px-3"
          defaultValue={values.quantity ?? ""}
          inputMode="decimal"
          name="quantity"
          placeholder="2.5"
          required
        />
      </label>
      <UnitSelect
        defaultValue={values.fromUnitId}
        label="From unit"
        name="fromUnitId"
        units={units}
      />
      <UnitSelect defaultValue={values.toUnitId} label="To unit" name="toUnitId" units={units} />
      <div className="flex items-end">
        <button
          className="min-h-11 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white"
          type="submit"
        >
          Convert quantity
        </button>
      </div>
    </form>
  );
}

function UnitSelect({
  label,
  name,
  units,
  defaultValue,
}: {
  label: string;
  name: string;
  units: readonly QuantityUnitRecord[];
  defaultValue?: string | undefined;
}) {
  return (
    <label className="text-sm font-medium">
      {label}
      <select
        className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] bg-white px-3"
        defaultValue={defaultValue ?? ""}
        name={name}
        required
      >
        <option disabled value="">
          Select…
        </option>
        {units.map((unit) => (
          <option key={unit.id} value={unit.id}>
            {unit.name} ({unit.symbol}) · {unit.dimension}
          </option>
        ))}
      </select>
    </label>
  );
}
