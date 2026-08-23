"use server";

import type { MasterActionState } from "@/components/master-data/action-state";
import {
  executeSaveItemAction,
  executeSetItemStatusAction,
} from "@/server/master-data/item-action-handlers";

const route = "/inventory/raw-materials";
export async function saveRawMaterialAction(_state: MasterActionState, formData: FormData) {
  return executeSaveItemAction("RAW_MATERIAL", route, formData);
}
export async function setRawMaterialStatusAction(_state: MasterActionState, formData: FormData) {
  return executeSetItemStatusAction("RAW_MATERIAL", route, formData);
}
