import { describe, expect, it } from "vitest";

import type { ApplicationPrincipal } from "@/modules/access/domain/principal";

import { appNavigation, getActiveNavigationItem, getPermittedNavigation } from "./navigation";

describe("application navigation", () => {
  it("defines each Phase 2 top-level destination once", () => {
    expect(appNavigation.map((item) => item.href)).toEqual([
      "/dashboard",
      "/inventory",
      "/purchasing",
      "/production",
      "/sales",
      "/accounting",
      "/reports",
      "/administration",
    ]);
  });

  it("matches a nested future path to its owning module", () => {
    expect(getActiveNavigationItem("/inventory/stock-movements")?.label).toBe("Inventory");
  });

  it("does not assign an application module to unrelated routes", () => {
    expect(getActiveNavigationItem("/system-health")).toBeUndefined();
  });

  it("filters modules for a sales user", () => {
    const principal: ApplicationPrincipal = {
      id: "sales",
      name: "Sales",
      email: "sales@example.com",
      active: true,
      roleCodes: ["SALES"],
      permissions: ["dashboard.view", "sales.view", "sales.manage"],
    };
    expect(getPermittedNavigation(principal).map(({ id }) => id)).toEqual(["dashboard", "sales"]);
  });

  it("shows real administration links according to permissions", () => {
    const principal: ApplicationPrincipal = {
      id: "admin",
      name: "Admin",
      email: "admin@example.com",
      active: true,
      roleCodes: ["ADMIN"],
      permissions: ["users.view", "roles.manage"],
    };
    const administration = getPermittedNavigation(principal).find(
      ({ id }) => id === "administration",
    );
    expect(
      administration?.children?.filter(({ status }) => status === "active").map(({ href }) => href),
    ).toEqual(["/administration/users", "/administration/roles-permissions"]);
  });
});
