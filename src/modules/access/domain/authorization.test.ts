import { describe, expect, it } from "vitest";

import { mergePermissions } from "../application/access-control";
import { DEFAULT_ROLE_PERMISSIONS } from "./default-roles";
import { hasPermission, type ApplicationPrincipal } from "./principal";
import { PERMISSIONS, type PermissionCode } from "./permissions";

const expectedPermissions = [
  "dashboard.view",
  "inventory.view",
  "inventory.manage",
  "purchasing.view",
  "purchasing.manage",
  "production.view",
  "production.manage",
  "sales.view",
  "sales.manage",
  "accounting.view",
  "accounting.manage",
  "reports.view",
  "users.view",
  "users.manage",
  "roles.manage",
  "audit.view",
] as const;

function principal(permissions: readonly PermissionCode[], active = true): ApplicationPrincipal {
  return {
    id: "user-1",
    name: "Operator",
    email: "operator@example.com",
    active,
    roleCodes: ["SALES"],
    permissions,
  };
}

describe("access-control domain", () => {
  it("defines the approved permission registry exactly once", () => {
    // Defect caught: misspelled or omitted codes could silently bypass intended policy mappings.
    expect(PERMISSIONS).toEqual(expectedPermissions);
  });

  it("uses permission membership rather than a role-name branch", () => {
    // Defect caught: a SALES role check could incorrectly authorize unrelated users or deny custom mappings.
    expect(hasPermission(principal(["inventory.view"]), "inventory.view")).toBe(true);
    expect(hasPermission(principal([]), "inventory.view")).toBe(false);
  });

  it("deduplicates permissions resolved from multiple roles", () => {
    // Defect caught: duplicate joins could leak unstable permission collections to guards/navigation.
    expect(mergePermissions([["dashboard.view", "sales.view"], ["dashboard.view"]])).toEqual([
      "dashboard.view",
      "sales.view",
    ]);
  });

  it("maps SUPER_ADMIN to all permissions and SALES only to its approved module", () => {
    // Defect caught: seeded roles could drift from the approved least-privilege matrix.
    expect(DEFAULT_ROLE_PERMISSIONS.SUPER_ADMIN).toEqual(expectedPermissions);
    expect(DEFAULT_ROLE_PERMISSIONS.SALES).toEqual([
      "dashboard.view",
      "sales.view",
      "sales.manage",
    ]);
  });
});
