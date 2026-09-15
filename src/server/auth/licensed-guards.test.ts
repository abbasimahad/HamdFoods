import { beforeEach, describe, expect, it, vi } from "vitest";

const requirePermissionMock = vi.fn();
const requireAnyPermissionMock = vi.fn();
const getLicenseStatusMock = vi.fn();
const redirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});

vi.mock("./server-guards", () => ({
  requirePermission: requirePermissionMock,
  requireAnyPermission: requireAnyPermissionMock,
}));
vi.mock("@/server/licensing/license-service", () => ({
  getLicenseStatus: getLicenseStatusMock,
}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

const actor = { id: "user-1" } as never;

beforeEach(() => {
  requirePermissionMock.mockReset().mockResolvedValue(actor);
  requireAnyPermissionMock.mockReset().mockResolvedValue(actor);
  getLicenseStatusMock.mockReset();
  redirectMock.mockClear();
});

describe("licensed-guards requirePermission", () => {
  it("returns the actor unchanged when the license allows mutations", async () => {
    getLicenseStatusMock.mockReturnValue({ mutationAllowed: true });
    const { requirePermission } = await import("./licensed-guards");
    const result = await requirePermission("purchasing.manage");
    expect(result).toBe(actor);
    expect(requirePermissionMock).toHaveBeenCalledWith("purchasing.manage");
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("redirects to the license panel when the license blocks mutations", async () => {
    getLicenseStatusMock.mockReturnValue({ mutationAllowed: false });
    const { requirePermission } = await import("./licensed-guards");
    await expect(requirePermission("purchasing.manage")).rejects.toThrow(
      "NEXT_REDIRECT:/administration/license",
    );
  });

  it("propagates an authorization failure without checking license status", async () => {
    requirePermissionMock.mockRejectedValue(new Error("NEXT_REDIRECT:/access-denied"));
    const { requirePermission } = await import("./licensed-guards");
    await expect(requirePermission("purchasing.manage")).rejects.toThrow(
      "NEXT_REDIRECT:/access-denied",
    );
    expect(getLicenseStatusMock).not.toHaveBeenCalled();
  });
});

describe("licensed-guards requireAnyPermission", () => {
  it("returns the actor unchanged when the license allows mutations", async () => {
    getLicenseStatusMock.mockReturnValue({ mutationAllowed: true });
    const { requireAnyPermission } = await import("./licensed-guards");
    const result = await requireAnyPermission(["purchasing.manage", "purchasing.view"]);
    expect(result).toBe(actor);
    expect(requireAnyPermissionMock).toHaveBeenCalledWith(["purchasing.manage", "purchasing.view"]);
  });

  it("redirects to the license panel when the license blocks mutations", async () => {
    getLicenseStatusMock.mockReturnValue({ mutationAllowed: false });
    const { requireAnyPermission } = await import("./licensed-guards");
    await expect(requireAnyPermission(["purchasing.manage"])).rejects.toThrow(
      "NEXT_REDIRECT:/administration/license",
    );
  });
});
