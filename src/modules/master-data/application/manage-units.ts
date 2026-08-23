import { z } from "zod";

import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import { supportedQuantityUnitDimension } from "@/modules/quantity/domain/quantity";

import { isValidMasterCode, normalizeMasterCode, UNIT_DIMENSIONS } from "../domain/master-data";
import {
  forbiddenUnlessManage,
  repositoryFailure,
  type MasterDataRepository,
  type MasterMutationResult,
} from "./contracts";

const codeSchema = z
  .string()
  .transform(normalizeMasterCode)
  .refine(isValidMasterCode, "Use letters, numbers, spaces, underscores, or hyphens.");

export const unitInputSchema = z
  .object({
    id: z.string().min(1).optional(),
    code: codeSchema,
    name: z.string().trim().min(1).max(120),
    symbol: z.string().trim().min(1).max(20),
    dimension: z.enum(UNIT_DIMENSIONS),
  })
  .superRefine((value, context) => {
    const supportedDimension = supportedQuantityUnitDimension(value.code);
    if (supportedDimension && value.dimension !== supportedDimension) {
      context.addIssue({
        code: "custom",
        path: ["dimension"],
        message: `${value.code} must use the ${supportedDimension} dimension.`,
      });
    }
  });

export async function saveUnit(
  actor: ApplicationPrincipal,
  input: unknown,
  repository: MasterDataRepository,
): Promise<MasterMutationResult> {
  const forbidden = forbiddenUnlessManage(actor);
  if (forbidden) return forbidden;
  const parsed = unitInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "validation", message: "Check the unit details." };
  }
  try {
    return { ok: true, id: await repository.saveUnit(parsed.data) };
  } catch (error) {
    return repositoryFailure(error);
  }
}

export async function setUnitActive(
  actor: ApplicationPrincipal,
  id: string,
  active: boolean,
  repository: MasterDataRepository,
): Promise<MasterMutationResult> {
  const forbidden = forbiddenUnlessManage(actor);
  if (forbidden) return forbidden;
  try {
    return (await repository.setUnitActive(id, active))
      ? { ok: true }
      : { ok: false, reason: "not-found", message: "The unit no longer exists." };
  } catch (error) {
    return repositoryFailure(error);
  }
}
