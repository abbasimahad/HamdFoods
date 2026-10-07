import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/db/prisma", () => ({ prisma: {} }));
vi.mock("@/server/accounting/prisma-accounting-repository", () => ({ reconciliation: vi.fn() }));
vi.mock("@/server/audit/audit-event", () => ({ recordAuditEvent: vi.fn() }));

const { pendingReopenRequest } = await import("./period-close");

const at = (minute: number) => new Date(Date.UTC(2026, 9, 7, 10, minute));
const event = (action: string, minute: number, actorUserId = "accounts") => ({
  action,
  createdAt: at(minute),
  actorUserId,
  reason: `${action} reason`,
});

describe("pendingReopenRequest (ROLE-3 two-person reopen)", () => {
  it("returns the latest request while it has not been decided", () => {
    expect(
      pendingReopenRequest([event("CLOSED", 1, "admin"), event("REOPEN_REQUESTED", 2)])?.reason,
    ).toBe("REOPEN_REQUESTED reason");
  });

  it("is cleared by an approval, a rejection or a later close", () => {
    for (const decision of ["REOPENED", "REOPEN_REJECTED", "CLOSED"])
      expect(
        pendingReopenRequest([event("REOPEN_REQUESTED", 2), event(decision, 3, "admin")]),
      ).toBeNull();
  });

  it("has nothing pending for a period that was never asked to reopen", () => {
    expect(pendingReopenRequest([event("CLOSED", 1)])).toBeNull();
    expect(pendingReopenRequest([])).toBeNull();
  });
});
