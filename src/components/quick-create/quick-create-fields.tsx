import type { QuickCreateKind } from "@/modules/workflow-ux/application/quick-create-contracts";

export type QuickCreateReferences = {
  groups?: readonly { id: string; code: string; name: string }[];
  areas?: readonly { id: string; code: string; name: string }[];
  routes?: readonly { id: string; code: string; name: string }[];
  salespersons?: readonly { id: string; code: string; name: string }[];
  categories?: readonly { id: string; code: string; name: string }[];
  units?: readonly { id: string; code: string; name: string; dimension: string }[];
};

export function QuickCreateFields({
  kind,
  references = {},
}: {
  kind: QuickCreateKind;
  references?: QuickCreateReferences | undefined;
}) {
  if (kind === "customer") return <CustomerFields references={references} />;
  if (kind === "supplier") return <SupplierFields />;
  return <ItemFields kind={kind} references={references} />;
}

function CustomerFields({ references }: { references: QuickCreateReferences }) {
  return (
    <>
      <TextField label="Customer code" name="code" required />
      <TextField label="Customer name" name="name" required />
      <TextField label="Contact person" name="contactPerson" />
      <TextField label="Phone" name="phone" required />
      <TextField label="Secondary phone" name="secondaryPhone" />
      <TextField label="Email" name="email" type="email" />
      <TextField className="sm:col-span-2" label="Address" name="address" required />
      <TextField label="City" name="city" />
      <ReferenceSelect label="Customer group" name="customerGroupId" options={references.groups} />
      <ReferenceSelect label="Area" name="areaId" options={references.areas} required />
      <ReferenceSelect label="Route" name="routeId" options={references.routes} />
      <ReferenceSelect label="Salesperson" name="salespersonId" options={references.salespersons} />
      <TextField label="Tax registration" name="taxRegistrationNo" />
      <TextField label="Credit limit" name="creditLimit" type="number" />
      <TextField label="Payment terms (days)" name="paymentTermsDays" type="number" />
      <TextField className="sm:col-span-2" label="Notes" name="notes" />
    </>
  );
}

function SupplierFields() {
  return (
    <>
      <TextField label="Supplier code" name="code" required />
      <TextField label="Supplier name" name="name" required />
      <TextField label="Contact person" name="contactPerson" required />
      <TextField label="Phone" name="phone" required />
      <TextField label="Secondary phone" name="secondaryPhone" />
      <TextField label="Email" name="email" required type="email" />
      <TextField className="sm:col-span-2" label="Address" name="address" required />
      <TextField label="City" name="city" required />
      <TextField label="Tax registration" name="taxRegistrationNo" />
      <TextField label="Payment terms (days)" name="paymentTermsDays" type="number" />
      <TextField className="sm:col-span-2" label="Notes" name="notes" />
    </>
  );
}

function ItemFields({
  kind,
  references,
}: {
  kind: Exclude<QuickCreateKind, "customer" | "supplier">;
  references: QuickCreateReferences;
}) {
  return (
    <>
      <TextField label="Code" name="code" required />
      <TextField label="Name" name="name" required />
      <ReferenceSelect
        label="Category"
        name="categoryId"
        options={references.categories}
        required
      />
      <ReferenceSelect label="Stock unit" name="stockUnitId" options={references.units} required />
      {kind === "packaging" ? (
        <ReferenceSelect
          label="Packaging kind"
          name="packagingKind"
          options={[
            { id: "PRIMARY", code: "PRIMARY", name: "Primary" },
            { id: "SECONDARY", code: "SECONDARY", name: "Secondary" },
            { id: "TERTIARY", code: "TERTIARY", name: "Tertiary" },
          ]}
          required
        />
      ) : null}
      {kind === "product" ? (
        <>
          <TextField label="Net content" name="netContentQuantity" required type="number" />
          <ReferenceSelect
            label="Net-content unit"
            name="netContentUnitId"
            options={references.units?.filter((unit) =>
              ["MASS", "VOLUME"].includes(unit.dimension),
            )}
            required
          />
          <TextField label="Pieces per carton" name="piecesPerCarton" required type="number" />
        </>
      ) : null}
      <TextField className="sm:col-span-2" label="Description" name="description" />
    </>
  );
}

function TextField({
  label,
  name,
  required = false,
  type = "text",
  className = "",
}: {
  label: string;
  name: string;
  required?: boolean;
  type?: "text" | "email" | "number";
  className?: string;
}) {
  return (
    <label className={`text-sm font-medium ${className}`}>
      {label}
      <input
        className="mt-1 min-h-11 w-full rounded-lg border border-[var(--control-border)] px-3"
        min={type === "number" ? 0 : undefined}
        name={name}
        required={required}
        step={type === "number" ? "any" : undefined}
        type={type}
      />
    </label>
  );
}

function ReferenceSelect({
  label,
  name,
  options = [],
  required = false,
}: {
  label: string;
  name: string;
  options?: readonly { id: string; code: string; name: string }[] | undefined;
  required?: boolean;
}) {
  return (
    <label className="text-sm font-medium">
      {label}
      <select
        className="mt-1 min-h-11 w-full rounded-lg border border-[var(--control-border)] bg-white px-3"
        name={name}
        required={required}
      >
        <option value="">Select…</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.code} · {option.name}
          </option>
        ))}
      </select>
    </label>
  );
}
