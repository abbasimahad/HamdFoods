import { z } from "zod";
import { LANDED_COST_ALLOCATION_METHODS, PRODUCTION_COST_CATEGORIES } from "../domain/costing";
import {
  requireInventoryCostManager,
  requireProductionCostManager,
  type CostingMutationResult,
  type InventoryValuationRepository,
} from "./contracts";
import type { ApplicationPrincipal } from "@/modules/access/domain/principal";

const optional = (max: number) =>
  z.preprocess((value) => String(value ?? "").trim() || undefined, z.string().max(max).optional());
export async function initializeValuationIssue(
  actor: ApplicationPrincipal,
  form: Record<string, unknown>,
  repository: InventoryValuationRepository,
): Promise<CostingMutationResult> {
  const denied = requireInventoryCostManager(actor);
  if (denied) return denied;
  const parsed = z
    .object({
      issueId: z.string().uuid(),
      totalValue: z.string().trim().max(61),
      reason: z.string().trim().min(3).max(1000),
      reference: optional(160),
    })
    .safeParse(form);
  if (!parsed.success)
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid valuation initialization.",
    };
  try {
    return {
      ok: true,
      id: await repository.initializeIssue(
        parsed.data.issueId,
        parsed.data.totalValue,
        parsed.data.reason,
        parsed.data.reference,
        actor.id,
      ),
    };
  } catch (error) {
    return fail(error, "Valuation initialization failed.");
  }
}
export async function rebuildValuation(
  actor: ApplicationPrincipal,
  repository: InventoryValuationRepository,
): Promise<CostingMutationResult> {
  const denied = requireInventoryCostManager(actor);
  if (denied) return denied;
  try {
    const result = await repository.rebuild(actor.id);
    return {
      ok: true,
      message: `Valuation rebuild processed ${result.processed} event(s); ${result.unresolved} unresolved basis issue(s).`,
    };
  } catch (error) {
    return fail(error, "Valuation rebuild failed.");
  }
}
export async function postValuationAdjustment(
  actor: ApplicationPrincipal,
  form: Record<string, unknown>,
  repository: InventoryValuationRepository,
): Promise<CostingMutationResult> {
  const denied = requireInventoryCostManager(actor);
  if (denied) return denied;
  const parsed = z
    .object({
      itemId: z.string().uuid(),
      valueDelta: z.string().trim().max(61),
      reason: z.string().trim().min(3).max(1000),
      reference: optional(160),
    })
    .safeParse(form);
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid cost adjustment." };
  try {
    return {
      ok: true,
      id: await repository.adjustItemValue(
        parsed.data.itemId,
        parsed.data.valueDelta,
        parsed.data.reason,
        parsed.data.reference,
        actor.id,
      ),
    };
  } catch (error) {
    return fail(error, "Valuation adjustment failed.");
  }
}
export async function postLandedCost(
  actor: ApplicationPrincipal,
  form: Record<string, unknown>,
  repository: InventoryValuationRepository,
): Promise<CostingMutationResult> {
  const denied = requireInventoryCostManager(actor);
  if (denied) return denied;
  const parsed = z
    .object({
      goodsReceiptId: z.string().uuid(),
      allocationMethod: z.enum(LANDED_COST_ALLOCATION_METHODS),
      category: z.string().trim().min(2).max(80),
      totalAmount: z.string().trim().max(61),
      description: z.string().trim().min(3).max(1000),
      reference: optional(160),
      allocationsJson: z.string(),
    })
    .safeParse(form);
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid landed cost." };
  let allocations: unknown = [];
  try {
    allocations = JSON.parse(parsed.data.allocationsJson);
  } catch {
    return { ok: false, message: "Landed-cost allocations are invalid." };
  }
  const lines = z
    .array(
      z.object({
        goodsReceiptLineId: z.string().uuid(),
        allocatedAmount: z.string().trim().max(61),
      }),
    )
    .min(1)
    .safeParse(allocations);
  if (!lines.success) return { ok: false, message: "Landed-cost allocations are invalid." };
  try {
    return {
      ok: true,
      id: await repository.createAndPostLandedCost({
        ...parsed.data,
        allocations: lines.data,
        actorUserId: actor.id,
      }),
    };
  } catch (error) {
    return fail(error, "Landed cost failed.");
  }
}
export async function addProductionCost(
  actor: ApplicationPrincipal,
  form: Record<string, unknown>,
  repository: InventoryValuationRepository,
): Promise<CostingMutationResult> {
  const denied = requireProductionCostManager(actor);
  if (denied) return denied;
  const parsed = z
    .object({
      productionBatchId: z.string().uuid(),
      category: z.enum(PRODUCTION_COST_CATEGORIES),
      amount: z.string().trim().max(61),
      description: z.string().trim().min(3).max(1000),
      reference: optional(160),
    })
    .safeParse(form);
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid production cost." };
  try {
    return {
      ok: true,
      id: await repository.addProductionCostEntry({ ...parsed.data, actorUserId: actor.id }),
    };
  } catch (error) {
    return fail(error, "Production cost entry failed.");
  }
}
export async function finalizeProductionCost(
  actor: ApplicationPrincipal,
  batchId: string,
  repository: InventoryValuationRepository,
): Promise<CostingMutationResult> {
  const denied = requireProductionCostManager(actor);
  if (denied) return denied;
  if (!z.string().uuid().safeParse(batchId).success)
    return { ok: false, message: "Production batch is invalid." };
  try {
    await repository.finalizeBatchCost(batchId, actor.id);
    return { ok: true };
  } catch (error) {
    return fail(error, "Batch cost finalization failed.");
  }
}
function fail(error: unknown, fallback: string): CostingMutationResult {
  return { ok: false, message: error instanceof Error ? error.message : fallback };
}
