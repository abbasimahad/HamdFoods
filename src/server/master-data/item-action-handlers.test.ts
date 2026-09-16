import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Phase 35 M1 regression test: item-action-handlers.ts must route its
// mutations through the licensed guard (@/server/auth/licensed-guards), not
// the unrestricted one, so a restricted license state blocks raw-material,
// finished-good, and packaging-material saves/status changes exactly like
// every other business mutation. This exercises the real licensed-guards
// wrapper (not mocked) so a future accidental import of the unrestricted
// guard here would make this test fail.

const requirePermissionMock = vi.fn();
const getLicenseStatusMock = vi.fn();
const redirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
const saveItemMock = vi.fn();
const setItemActiveMock = vi.fn();

vi.mock("@/server/auth/server-guards", () => ({
  requirePermission: requirePermissionMock,
}));
vi.mock("@/server/licensing/license-service", () => ({
  getLicenseStatus: getLicenseStatusMock,
}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/modules/master-data/application/manage-items", () => ({
  saveItem: saveItemMock,
  setItemActive: setItemActiveMock,
}));
vi.mock("./prisma-master-data-repository", () => ({
  PrismaMasterDataRepository: vi.fn(),
}));

const actor = { id: "user-1" } as never;

beforeEach(() => {
  requirePermissionMock.mockReset().mockResolvedValue(actor);
  getLicenseStatusMock.mockReset();
  redirectMock.mockClear();
  saveItemMock.mockReset().mockResolvedValue({ ok: true });
  setItemActiveMock.mockReset().mockResolvedValue({ ok: true });
});

const itemTypes = ["RAW_MATERIAL", "FINISHED_GOOD", "PACKAGING_MATERIAL"] as const;

describe("item-action-handlers license enforcement", () => {
  it.each(itemTypes)(
    "blocks executeSaveItemAction(%s) when the license restricts mutations",
    async (itemType) => {
      getLicenseStatusMock.mockReturnValue({ mutationAllowed: false });
      const { executeSaveItemAction } = await import("./item-action-handlers");
      await expect(
        executeSaveItemAction(itemType, "/inventory/test", new FormData()),
      ).rejects.toThrow("NEXT_REDIRECT:/administration/license");
      expect(saveItemMock).not.toHaveBeenCalled();
    },
  );

  it.each(itemTypes)(
    "blocks executeSetItemStatusAction(%s) when the license restricts mutations",
    async (itemType) => {
      getLicenseStatusMock.mockReturnValue({ mutationAllowed: false });
      const formData = new FormData();
      formData.set("id", "item-1");
      formData.set("active", "false");
      const { executeSetItemStatusAction } = await import("./item-action-handlers");
      await expect(
        executeSetItemStatusAction(itemType, "/inventory/test", formData),
      ).rejects.toThrow("NEXT_REDIRECT:/administration/license");
      expect(setItemActiveMock).not.toHaveBeenCalled();
    },
  );

  it("allows executeSaveItemAction when the license permits mutations", async () => {
    getLicenseStatusMock.mockReturnValue({ mutationAllowed: true });
    const { executeSaveItemAction } = await import("./item-action-handlers");
    const result = await executeSaveItemAction("RAW_MATERIAL", "/inventory/test", new FormData());
    expect(result.status).toBe("success");
    expect(saveItemMock).toHaveBeenCalledOnce();
  });

  it("requires inventory.manage before ever checking license status", async () => {
    requirePermissionMock.mockRejectedValue(new Error("NEXT_REDIRECT:/access-denied"));
    const { executeSaveItemAction } = await import("./item-action-handlers");
    await expect(
      executeSaveItemAction("RAW_MATERIAL", "/inventory/test", new FormData()),
    ).rejects.toThrow("NEXT_REDIRECT:/access-denied");
    expect(getLicenseStatusMock).not.toHaveBeenCalled();
    expect(requirePermissionMock).toHaveBeenCalledWith("inventory.manage");
  });
});
