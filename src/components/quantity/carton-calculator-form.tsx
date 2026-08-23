import type { FinishedGoodOption } from "@/modules/quantity/application/contracts";

export function CartonCalculatorForm({
  finishedGoods,
  values,
}: {
  finishedGoods: readonly FinishedGoodOption[];
  values: { finishedGoodId?: string; cartons?: string; loosePieces?: string };
}) {
  return (
    <form className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" method="get">
      <input name="calculation" type="hidden" value="carton" />
      <label className="text-sm font-medium sm:col-span-2 xl:col-span-1">
        Finished good
        <select
          className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] bg-white px-3"
          defaultValue={values.finishedGoodId ?? ""}
          name="finishedGoodId"
          required
        >
          <option disabled value="">
            Select…
          </option>
          {finishedGoods.map((item) => (
            <option key={item.id} value={item.id}>
              {item.code} · {item.name}
            </option>
          ))}
        </select>
      </label>
      <IntegerField defaultValue={values.cartons} label="Cartons" name="cartons" />
      <IntegerField defaultValue={values.loosePieces} label="Loose pieces" name="loosePieces" />
      <div className="flex items-end">
        <button
          className="min-h-11 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white"
          type="submit"
        >
          Calculate cartons
        </button>
      </div>
    </form>
  );
}

function IntegerField({
  label,
  name,
  defaultValue,
}: {
  label: string;
  name: string;
  defaultValue?: string | undefined;
}) {
  return (
    <label className="text-sm font-medium">
      {label}
      <input
        className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] px-3"
        defaultValue={defaultValue ?? "0"}
        inputMode="numeric"
        name={name}
        required
      />
    </label>
  );
}
