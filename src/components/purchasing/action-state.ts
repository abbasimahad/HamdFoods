export type PurchasingActionState = { ok: boolean; message: string };
export const initialPurchasingActionState: PurchasingActionState = { ok: false, message: "" };
export type PurchasingAction = (
  state: PurchasingActionState,
  formData: FormData,
) => Promise<PurchasingActionState>;
