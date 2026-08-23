"use server";

import type { MasterActionState } from "@/components/master-data/action-state";
import {
  executeSaveItemAction,
  executeSetItemStatusAction,
} from "@/server/master-data/item-action-handlers";

const route = "/inventory/packaging-materials";
export async function savePackagingMaterialAction(_state: MasterActionState, formData: FormData) {
  return executeSaveItemAction("PACKAGING_MATERIAL", route, formData);
}
export async function setPackagingMaterialStatusAction(
  _state: MasterActionState,
  formData: FormData,
) {
  return executeSetItemStatusAction("PACKAGING_MATERIAL", route, formData);
}
