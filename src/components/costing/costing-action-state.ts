export type CostingActionState = { ok: boolean; message: string };
export type CostingAction = (
  state: CostingActionState,
  formData: FormData,
) => Promise<CostingActionState>;
export const initialCostingActionState: CostingActionState = { ok: false, message: "" };
