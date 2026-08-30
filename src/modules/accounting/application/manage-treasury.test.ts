import { describe, expect, it, vi } from "vitest";

import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import * as treasuryManagement from "./manage-treasury";
import type { TreasuryRepository } from "./treasury-contracts";

const manager: ApplicationPrincipal = {
  id: "manager-id",
  name: "Manager",
  email: "manager@example.com",
  active: true,
  roleCodes: ["ACCOUNTING_MANAGER"],
  permissions: ["accounting.manage"],
};

describe("treasury-transfer reversal", () => {
  // Defect: a posted treasury transfer has a server implementation but no application entry point,
  // so an authorized user cannot request its linked compensating reversal.
  it("delegates an authorized reversal with its date and reason", async () => {
    const reverse = vi.fn(async () => "reversal-id");
    const reverseTreasuryTransfer = Reflect.get(treasuryManagement, "reverseTreasuryTransfer") as
      | ((
          actor: ApplicationPrincipal,
          id: string,
          reversalDate: Date,
          reason: string,
          repository: TreasuryRepository,
        ) => Promise<string>)
      | undefined;

    expect(reverseTreasuryTransfer).toBeTypeOf("function");
    const reversalDate = new Date("2026-08-30T00:00:00.000Z");
    await expect(
      reverseTreasuryTransfer!(
        manager,
        "transfer-id",
        reversalDate,
        "Bank entry error",
        repository(reverse),
      ),
    ).resolves.toBe("reversal-id");
    expect(reverse).toHaveBeenCalledWith(
      "transfer-id",
      "manager-id",
      reversalDate,
      "Bank entry error",
    );
  });

  it("rejects callers without accounting management permission", async () => {
    const reverseTreasuryTransfer = Reflect.get(treasuryManagement, "reverseTreasuryTransfer") as
      | ((
          actor: ApplicationPrincipal,
          id: string,
          reversalDate: Date,
          reason: string,
          repository: TreasuryRepository,
        ) => Promise<string>)
      | undefined;
    const reverse = vi.fn(async () => "reversal-id");

    expect(reverseTreasuryTransfer).toBeTypeOf("function");
    await expect(
      reverseTreasuryTransfer!(
        { ...manager, permissions: [] },
        "transfer-id",
        new Date("2026-08-30T00:00:00.000Z"),
        "Bank entry error",
        repository(reverse),
      ),
    ).rejects.toThrow("Accounting management permission is required.");
    expect(reverse).not.toHaveBeenCalled();
  });
});

function repository(reverseTransfer: TreasuryRepository["reverseTransfer"]): TreasuryRepository {
  return {
    createAccount: vi.fn(async () => undefined),
    saveTransfer: vi.fn(async () => "transfer-id"),
    postTransfer: vi.fn(async () => undefined),
    cancelTransfer: vi.fn(async () => undefined),
    reverseTransfer,
  };
}
