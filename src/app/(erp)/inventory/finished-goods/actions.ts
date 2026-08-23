"use server";

import type { MasterActionState } from "@/components/master-data/action-state";
import {
  executeSaveItemAction,
  executeSetItemStatusAction,
} from "@/server/master-data/item-action-handlers";

const route = "/inventory/finished-goods";
export async function saveFinishedGoodAction(_state: MasterActionState, formData: FormData) {
  return executeSaveItemAction("FINISHED_GOOD", route, formData);
}
export async function setFinishedGoodStatusAction(_state: MasterActionState, formData: FormData) {
  return executeSetItemStatusAction("FINISHED_GOOD", route, formData);
}
