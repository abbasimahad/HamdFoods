export type InventoryActionState = { ok: boolean; message: string };
export const initialInventoryActionState: InventoryActionState = { ok: false, message: "" };
export type InventoryAction = (
  state: InventoryActionState,
  formData: FormData,
) => Promise<InventoryActionState>;
