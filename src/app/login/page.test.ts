import { beforeEach, describe, expect, it, vi } from "vitest";

import { PERMISSIONS } from "@/modules/access/domain/permissions";

const mocks = vi.hoisted(() => ({
  getCurrentPrincipal: vi.fn(),
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/server/auth/server-guards", () => ({
  getCurrentPrincipal: mocks.getCurrentPrincipal,
}));

import LoginPage from "./page";

describe("LoginPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redirects the development bypass principal to the dashboard", async () => {
    // Defect caught: bypass mode could still render the credential form instead of entering the ERP.
    mocks.getCurrentPrincipal.mockResolvedValue({
      id: "dev-auth-bypass",
      name: "Development Factory Owner",
      email: "dev-auth-bypass@hamdfoods.local",
      active: true,
      roleCodes: ["SUPER_ADMIN"],
      permissions: PERMISSIONS,
    });

    await expect(LoginPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith("/dashboard");
  });

  it("renders the normal sign-in page when no principal is resolved", async () => {
    // Defect caught: default-off mode could skip login for an unauthenticated request.
    mocks.getCurrentPrincipal.mockResolvedValue(null);

    const page = await LoginPage();
    expect(page.type).toBe("main");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
