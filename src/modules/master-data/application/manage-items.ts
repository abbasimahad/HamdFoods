import { z } from "zod";

import type { ApplicationPrincipal } from "@/modules/access/domain/principal";

import {
  isPositiveDecimalString,
  isValidMasterCode,
  normalizeMasterCode,
  PACKAGING_KINDS,
} from "../domain/master-data";
import {
  isCanonicalPieceUnit,
  isSupportedQuantityUnitCode,
  supportedQuantityUnitDimension,
} from "@/modules/quantity/domain/quantity";
import {
  forbiddenUnlessManage,
  repositoryFailure,
  type ItemInput,
  type MasterDataRepository,
  type MasterMutationResult,
} from "./contracts";

const base = {
  id: z.string().min(1).optional(),
  code: z.string().transform(normalizeMasterCode).refine(isValidMasterCode),
  name: z.string().trim().min(1).max(160),
  categoryId: z.string().min(1),
  stockUnitId: z.string().min(1),
  description: z
    .string()
    .trim()
    .max(2_000)
    .optional()
    .transform((value) => value || undefined),
};

export const itemInputSchema = z.discriminatedUnion("itemType", [
  z.object({ ...base, itemType: z.literal("RAW_MATERIAL") }),
  z.object({
    ...base,
    itemType: z.literal("PACKAGING_MATERIAL"),
    packagingKind: z.enum(PACKAGING_KINDS),
  }),
  z.object({
    ...base,
    itemType: z.literal("FINISHED_GOOD"),
    netContentQuantity: z.string().trim().refine(isPositiveDecimalString),
    netContentUnitId: z.string().min(1),
    piecesPerCarton: z.coerce.number().int().positive().max(2_147_483_647),
  }),
]);

export async function saveItem(
  actor: ApplicationPrincipal,
  input: unknown,
  repository: MasterDataRepository,
): Promise<MasterMutationResult> {
  const forbidden = forbiddenUnlessManage(actor);
  if (forbidden) return forbidden;
  const parsed = itemInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "validation", message: "Check the item details." };
  }
  try {
    const category = await repository.getCategory(parsed.data.categoryId);
    const stockUnit = await repository.getUnit(parsed.data.stockUnitId);
    if (!category?.active || category.itemType !== parsed.data.itemType || !stockUnit?.active) {
      return {
        ok: false,
        reason: "invalid-reference",
        message: "Select an active category and stock unit valid for this item type.",
      };
    }
    if (parsed.data.itemType === "FINISHED_GOOD") {
      if (!isCanonicalPieceUnit(stockUnit)) {
        return {
          ok: false,
          reason: "invalid-reference",
          message: "Finished goods must use the active PCS count unit as their stock unit.",
        };
      }
      const contentUnit = await repository.getUnit(parsed.data.netContentUnitId);
      if (
        !contentUnit?.active ||
        !["MASS", "VOLUME"].includes(contentUnit.dimension) ||
        !isSupportedQuantityUnitCode(contentUnit.code) ||
        supportedQuantityUnitDimension(contentUnit.code) !== contentUnit.dimension
      ) {
        return {
          ok: false,
          reason: "invalid-reference",
          message: "Net-content unit must be an active supported mass or volume unit.",
        };
      }
    }
    return { ok: true, id: await repository.saveItem(parsed.data as ItemInput) };
  } catch (error) {
    return repositoryFailure(error);
  }
}

export async function setItemActive(
  actor: ApplicationPrincipal,
  id: string,
  itemType: ItemInput["itemType"],
  active: boolean,
  repository: MasterDataRepository,
): Promise<MasterMutationResult> {
  const forbidden = forbiddenUnlessManage(actor);
  if (forbidden) return forbidden;
  try {
    return (await repository.setItemActive(id, itemType, active))
      ? { ok: true }
      : { ok: false, reason: "not-found", message: "The item no longer exists." };
  } catch (error) {
    return repositoryFailure(error);
  }
}
