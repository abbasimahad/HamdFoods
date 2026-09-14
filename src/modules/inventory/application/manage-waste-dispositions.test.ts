import { describe, expect, it, vi } from "vitest";

import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import {
  cancelWasteDisposition,
  postWasteDisposition,
  reverseWasteDisposition,
  saveWasteDispositionDraft,
} from "./manage-waste-dispositions";
import type { WasteDispositionRepository } from "./waste-disposition-contracts";

const actor: ApplicationPrincipal = {
  id: "00000000-0000-4000-8000-000000000001",
  active: true,
  email: "store@example.test",
  name: "Store Keeper",
  roleCodes: ["STORE_KEEPER"],
  permissions: ["inventory.manage"],
};
const id = "00000000-0000-4000-8000-000000000010";
const form = {
  dispositionDate: "2026-09-13",
  warehouseId: "00000000-0000-4000-8000-000000000002",
  lines: [
    {
      itemId: "00000000-0000-4000-8000-000000000003",
      productionLotId: "00000000-0000-4000-8000-000000000004",
      sourceStatus: "DAMAGED",
      quantity: "1",
      unitId: "00000000-0000-4000-8000-000000000005",
      action: "MOVE_TO_SCRAP",
      reason: "DAMAGED",
    },
  ],
};

function repository(): WasteDispositionRepository {
  return {
    saveDraft: vi.fn().mockResolvedValue(id),
    post: vi.fn(),
    cancel: vi.fn(),
    reverse: vi.fn(),
  };
}

describe("waste disposition application authority", () => {
  it("saves a validated draft for inventory.manage", async () => {
    const repo = repository();
    expect(await saveWasteDispositionDraft(actor, form, repo)).toEqual({ ok: true, id });
    expect(repo.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: actor.id }));
  });

  it("denies production.manage and inactive direct invocations", async () => {
    const repo = repository();
    const production = { ...actor, permissions: ["production.manage"] as const };
    expect(await saveWasteDispositionDraft(production, form, repo)).toMatchObject({ ok: false });
    expect(await postWasteDisposition({ ...actor, active: false }, id, repo)).toMatchObject({
      ok: false,
    });
    expect(repo.saveDraft).not.toHaveBeenCalled();
    expect(repo.post).not.toHaveBeenCalled();
  });

  it("validates ids and cancellation reason before repository access", async () => {
    const repo = repository();
    expect(await postWasteDisposition(actor, "bad", repo)).toMatchObject({ ok: false });
    expect(await cancelWasteDisposition(actor, id, "", repo)).toMatchObject({ ok: false });
    expect(repo.post).not.toHaveBeenCalled();
    expect(repo.cancel).not.toHaveBeenCalled();
    expect(await reverseWasteDisposition(actor, id, "", repo)).toMatchObject({ ok: false });
    expect(repo.reverse).not.toHaveBeenCalled();
  });
});
