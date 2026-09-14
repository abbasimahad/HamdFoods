import { describe, expect, it, vi } from "vitest";

import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import {
  cancelReprocess,
  decideReprocessQuality,
  reserveReprocess,
  saveReprocessDraft,
  startReprocess,
  updateReprocessDraft,
} from "./manage-reprocess";
import type { ReprocessRepository } from "./reprocess-contracts";

const actor: ApplicationPrincipal = {
  id: "00000000-0000-4000-8000-000000000001",
  active: true,
  email: "production@example.com",
  name: "Production Manager",
  roleCodes: ["PRODUCTION_MANAGER"],
  permissions: ["production.manage"],
};

const form = {
  sourceProductionLotId: "00000000-0000-4000-8000-000000000002",
  sourceWarehouseId: "00000000-0000-4000-8000-000000000003",
  sourceQuantity: "10",
  sourceUnitId: "00000000-0000-4000-8000-000000000004",
  recipeId: "00000000-0000-4000-8000-000000000005",
  plannedBatchQuantity: "10",
  plannedBatchUnitId: "00000000-0000-4000-8000-000000000004",
  plannedProductionDate: "2026-09-12",
  rawMaterialWarehouseId: "00000000-0000-4000-8000-000000000006",
  packagingWarehouseId: "00000000-0000-4000-8000-000000000007",
  finishedGoodsDestinationWarehouseId: "00000000-0000-4000-8000-000000000008",
  plannedCartons: "1",
  plannedLoosePieces: "0",
  reason: "Damaged packaging requires controlled rework.",
};

function repository(): ReprocessRepository {
  return {
    createDraft: vi.fn().mockResolvedValue("00000000-0000-4000-8000-000000000009"),
    updateDraftMetadata: vi.fn(),
    reserve: vi.fn(),
    start: vi.fn(),
    cancel: vi.fn(),
    decideQuality: vi.fn(),
  };
}

describe("saveReprocessDraft", () => {
  it("creates a draft with the authenticated actor and validated fields", async () => {
    const repo = repository();
    const result = await saveReprocessDraft(actor, form, repo);

    expect(result).toEqual({ ok: true, id: "00000000-0000-4000-8000-000000000009" });
    expect(repo.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceQuantity: "10",
        actorUserId: actor.id,
        reason: form.reason,
      }),
    );
  });

  it("requires production.manage", async () => {
    const repo = repository();
    const result = await saveReprocessDraft(
      { ...actor, permissions: ["quality.manage"] },
      form,
      repo,
    );

    expect(result).toEqual({ ok: false, message: "Production management permission is required." });
    expect(repo.createDraft).not.toHaveBeenCalled();
  });

  it("edits only validated draft metadata through the repository", async () => {
    const repo = repository();
    const id = "00000000-0000-4000-8000-000000000009";

    expect(
      await updateReprocessDraft(
        actor,
        { id, reason: "Updated controlled reason", notes: "Updated notes" },
        repo,
      ),
    ).toEqual({ ok: true, id });
    expect(repo.updateDraftMetadata).toHaveBeenCalledWith({
      id,
      reason: "Updated controlled reason",
      notes: "Updated notes",
      actorUserId: actor.id,
    });
  });

  it("rejects malformed input before reaching the repository", async () => {
    const repo = repository();
    const result = await saveReprocessDraft(actor, { ...form, sourceQuantity: "" }, repo);

    expect(result.ok).toBe(false);
    expect(repo.createDraft).not.toHaveBeenCalled();
  });

  it("protects reserve and cancellation direct invocations", async () => {
    const repo = repository();
    const id = "00000000-0000-4000-8000-000000000009";
    expect(await reserveReprocess({ ...actor, permissions: [] }, id, repo)).toEqual({
      ok: false,
      message: "Production management permission is required.",
    });
    expect(await reserveReprocess(actor, "not-an-id", repo)).toEqual({
      ok: false,
      message: "Invalid reprocess document.",
    });
    expect(await cancelReprocess(actor, id, "", repo)).toEqual({
      ok: false,
      message: "Cancellation reason is required.",
    });
    expect(repo.reserve).not.toHaveBeenCalled();
    expect(repo.cancel).not.toHaveBeenCalled();
  });

  it("starts through the repository only for a production manager", async () => {
    const repo = repository();
    const id = "00000000-0000-4000-8000-000000000009";

    expect(await startReprocess(actor, id, repo)).toEqual({ ok: true, id });
    expect(repo.start).toHaveBeenCalledWith(id, actor.id);
    expect(await startReprocess({ ...actor, permissions: [] }, id, repo)).toEqual({
      ok: false,
      message: "Production management permission is required.",
    });
  });

  it("requires the separate quality permission for a direct QC invocation", async () => {
    const repo = repository();
    const id = "00000000-0000-4000-8000-000000000009";
    expect(await decideReprocessQuality(actor, { id, decision: "APPROVED" }, repo)).toEqual({
      ok: false,
      message: "Reprocess quality management permission is required.",
    });
    const quality = {
      ...actor,
      id: "00000000-0000-4000-8000-000000000010",
      permissions: ["quality.manage"] as const,
    };
    expect(await decideReprocessQuality(quality, { id, decision: "APPROVED" }, repo)).toEqual({
      ok: true,
      id,
    });
    expect(repo.decideQuality).toHaveBeenCalledWith({
      id,
      decision: "APPROVED",
      actorUserId: quality.id,
    });
  });
});
