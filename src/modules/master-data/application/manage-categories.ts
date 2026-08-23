import { z } from "zod";

import type { ApplicationPrincipal } from "@/modules/access/domain/principal";

import { isValidMasterCode, ITEM_TYPES, normalizeMasterCode } from "../domain/master-data";
import {
  forbiddenUnlessManage,
  repositoryFailure,
  type MasterDataRepository,
  type MasterMutationResult,
} from "./contracts";

export const categoryInputSchema = z.object({
  id: z.string().min(1).optional(),
  code: z.string().transform(normalizeMasterCode).refine(isValidMasterCode),
  name: z.string().trim().min(1).max(120),
  itemType: z.enum(ITEM_TYPES),
  description: z
    .string()
    .trim()
    .max(2_000)
    .optional()
    .transform((value) => value || undefined),
});

export async function saveCategory(
  actor: ApplicationPrincipal,
  input: unknown,
  repository: MasterDataRepository,
): Promise<MasterMutationResult> {
  const forbidden = forbiddenUnlessManage(actor);
  if (forbidden) return forbidden;
  const parsed = categoryInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "validation", message: "Check the category details." };
  }
  try {
    return { ok: true, id: await repository.saveCategory(parsed.data) };
  } catch (error) {
    return repositoryFailure(error);
  }
}

export async function setCategoryActive(
  actor: ApplicationPrincipal,
  id: string,
  active: boolean,
  repository: MasterDataRepository,
): Promise<MasterMutationResult> {
  const forbidden = forbiddenUnlessManage(actor);
  if (forbidden) return forbidden;
  try {
    return (await repository.setCategoryActive(id, active))
      ? { ok: true }
      : { ok: false, reason: "not-found", message: "The category no longer exists." };
  } catch (error) {
    return repositoryFailure(error);
  }
}
