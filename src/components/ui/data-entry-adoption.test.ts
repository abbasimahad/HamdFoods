import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const read = (path: string) => readFileSync(path, "utf8");
describe("shared data-entry adoption", () => {
  for (const file of [
    "src/components/master-data/unit-form.tsx",
    "src/components/master-data/category-form.tsx",
    "src/components/inventory/warehouse-form.tsx",
    "src/components/purchasing/supplier-form.tsx",
    "src/components/production/material-transaction-form.tsx",
    "src/components/production/packaging-transaction-form.tsx",
    "src/components/production/output-transaction-form.tsx",
    "src/components/sales/customer-form.tsx",
    "src/components/access/user-create-form.tsx",
  ]) {
    it(`${file} uses shared actions and feedback`, () => {
      const source = read(file);
      expect(source).toContain("FormActions");
      expect(source).toContain("ActionFeedback");
    });
  }
  for (const file of [
    "src/components/purchasing/purchase-order-form.tsx",
    "src/components/production/recipe-form.tsx",
    "src/components/sales/sales-order-form.tsx",
  ]) {
    it(`${file} uses shared line controls`, () =>
      expect(read(file)).toContain("LineEditorControls"));
  }
});
