import { describe, expect, it } from "vitest";

import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import {
  DEFAULT_ROLE_PERMISSIONS,
  type DefaultRoleCode,
} from "@/modules/access/domain/default-roles";
import {
  completeGoodsReceiptQc,
  saveGoodsReceipt,
} from "@/modules/purchasing/application/manage-goods-receipts";
import { approvePurchaseOrder } from "@/modules/purchasing/application/manage-purchase-orders";
import { postSalesInvoice } from "@/modules/sales/application/manage-sales-invoices";
import { completeSalesReturn } from "@/modules/sales/application/manage-sales-returns";

function principal(role: DefaultRoleCode): ApplicationPrincipal {
  return {
    id: `${role.toLowerCase()}-user`,
    name: role,
    email: `${role.toLowerCase()}@example.test`,
    active: true,
    roleCodes: [role],
    permissions: DEFAULT_ROLE_PERMISSIONS[role],
  };
}

// Repositories are never reached: every call either stops at the permission gate or at id
// validation ("not-a-uuid"), which runs only after the gate has passed.
const unreachable = new Proxy(
  {},
  {
    get() {
      throw new Error("Repository must not be reached in a permission test.");
    },
  },
) as never;

describe("ROLE-2: segregation of duties in the seeded roles", () => {
  it("a purchaser cannot approve, receive or QC its own purchase order", async () => {
    const purchaser = principal("PURCHASER");
    expect(await approvePurchaseOrder(purchaser, "not-a-uuid", unreachable)).toEqual({
      ok: false,
      message: "Purchase order approval permission is required.",
    });
    expect(await saveGoodsReceipt(purchaser, {}, unreachable)).toEqual({
      ok: false,
      message: "Goods receiving permission is required.",
    });
    expect(await completeGoodsReceiptQc(purchaser, "not-a-uuid", {}, unreachable)).toEqual({
      ok: false,
      message: "Receiving QC permission is required.",
    });
  });

  it("Accounts approves purchase orders; the store and Quality Control record receiving QC", async () => {
    expect(await approvePurchaseOrder(principal("ACCOUNTS"), "not-a-uuid", unreachable)).toEqual({
      ok: false,
      message: "Invalid purchase order.",
    });
    for (const role of ["STORE_KEEPER", "QUALITY_CONTROL"] as const)
      expect(await completeGoodsReceiptQc(principal(role), "not-a-uuid", {}, unreachable)).toEqual({
        ok: false,
        message: "Invalid goods receipt.",
      });
  });

  it("Sales cannot post invoices or customer credit notes; Accounts can", async () => {
    const sales = principal("SALES");
    expect(await postSalesInvoice(sales, "not-a-uuid", unreachable)).toEqual({
      ok: false,
      message: "Sales invoice posting permission is required.",
    });
    expect(await completeSalesReturn(sales, "not-a-uuid", unreachable)).toEqual({
      ok: false,
      message: "Customer credit posting permission is required.",
    });
    const accounts = principal("ACCOUNTS");
    expect(await postSalesInvoice(accounts, "not-a-uuid", unreachable)).toEqual({
      ok: false,
      message: "Invoice is invalid.",
    });
    expect(await completeSalesReturn(accounts, "not-a-uuid", unreachable)).toEqual({
      ok: false,
      message: "Sales return is invalid.",
    });
  });

  it("no seeded role other than administrators both orders and approves or receives", () => {
    for (const [role, permissions] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      if (role === "SUPER_ADMIN" || role === "ADMIN") continue;
      if (!permissions.includes("purchasing.manage")) continue;
      expect(permissions).not.toContain("purchase_orders.approve");
      expect(permissions).not.toContain("receiving.manage");
      expect(permissions).not.toContain("quality.manage");
    }
  });
});
