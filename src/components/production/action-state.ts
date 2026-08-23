export type ProductionActionState = { ok: boolean; message: string };
export const initialProductionActionState: ProductionActionState = { ok: false, message: "" };
export type ProductionAction = (
  state: ProductionActionState,
  formData: FormData,
) => Promise<ProductionActionState>;
