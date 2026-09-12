import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import { createSingleFlightGuard } from "@/components/ui/data-entry-state";

import { dispatchQuickCreate, type QuickCreateDependencies } from "./quick-create-dispatch";

const actor = (
  permissions: ApplicationPrincipal["permissions"],
  active = true,
): ApplicationPrincipal => ({
  id: "user-1",
  name: "Quick Create User",
  email: "quick-create@example.test",
  active,
  roleCodes: [],
  permissions,
});

function dependencies(): QuickCreateDependencies {
  return {
    saveCustomer: vi.fn().mockResolvedValue({ ok: true, id: "customer-1" }),
    saveSupplier: vi.fn().mockResolvedValue({ ok: true, id: "supplier-1" }),
    saveItem: vi.fn().mockResolvedValue({ ok: true, id: "item-1" }),
  };
}

describe("dispatchQuickCreate", () => {
  it.each([
    ["customer", "sales.manage", "saveCustomer", "customer-1"],
    ["supplier", "purchasing.manage", "saveSupplier", "supplier-1"],
    ["product", "inventory.manage", "saveItem", "item-1"],
    ["material", "inventory.manage", "saveItem", "item-1"],
    ["packaging", "inventory.manage", "saveItem", "item-1"],
  ] as const)(
    "uses the existing %s create seam and returns a sanitized option",
    async (kind, permission, dependency, id) => {
      const deps = dependencies();
      const result = await dispatchQuickCreate(
        actor([permission]),
        kind,
        { code: " new code ", name: " New name ", itemType: "FORGED" },
        deps,
      );

      expect(deps[dependency]).toHaveBeenCalledOnce();
      expect(result).toEqual({ ok: true, option: { value: id, label: "NEW-CODE · New name" } });
    },
  );

  it.each([
    ["product", "FINISHED_GOOD"],
    ["material", "RAW_MATERIAL"],
    ["packaging", "PACKAGING_MATERIAL"],
  ] as const)("locks %s to its authoritative item type", async (kind, itemType) => {
    const deps = dependencies();

    await dispatchQuickCreate(
      actor(["inventory.manage"]),
      kind,
      { code: "IT-1", name: "Item", itemType: "RAW_MATERIAL" },
      deps,
    );

    expect(deps.saveItem).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ itemType }),
    );
  });

  it.each([
    ["customer", "Sales management permission is required."],
    ["supplier", "Purchasing management permission is required."],
    ["product", "You cannot manage inventory master data."],
    ["material", "You cannot manage inventory master data."],
    ["packaging", "You cannot manage inventory master data."],
  ] as const)(
    "rejects unauthorized %s creation before invoking a dependency",
    async (kind, message) => {
      const deps = dependencies();

      const result = await dispatchQuickCreate(actor([]), kind, {}, deps);

      expect(result).toEqual({ ok: false, message });
      expect(deps.saveCustomer).not.toHaveBeenCalled();
      expect(deps.saveSupplier).not.toHaveBeenCalled();
      expect(deps.saveItem).not.toHaveBeenCalled();
    },
  );

  it("preserves validation and uniqueness failures without adding an option", async () => {
    const deps = dependencies();
    vi.mocked(deps.saveCustomer).mockResolvedValue({ ok: false, message: "Code already exists." });

    const result = await dispatchQuickCreate(
      actor(["sales.manage"]),
      "customer",
      { code: "C-1", name: "Customer" },
      deps,
    );

    expect(result).toEqual({ ok: false, message: "Code already exists." });
  });

  it("works with the shared guard so a rapid duplicate calls the create seam once", async () => {
    const deps = dependencies();
    const guard = createSingleFlightGuard();
    const guardedDispatch = async () => {
      if (!guard.enter()) return;
      try {
        return await dispatchQuickCreate(
          actor(["sales.manage"]),
          "customer",
          { code: "C-1", name: "Customer" },
          deps,
        );
      } finally {
        guard.leave();
      }
    };

    await Promise.all([guardedDispatch(), guardedDispatch()]);

    expect(deps.saveCustomer).toHaveBeenCalledOnce();
  });
});
