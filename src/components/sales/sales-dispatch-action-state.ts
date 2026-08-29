export type SalesDispatchActionState = { ok: boolean; message: string };
export type SalesDispatchAction = (
  state: SalesDispatchActionState,
  formData: FormData,
) => Promise<SalesDispatchActionState>;
export const initialSalesDispatchActionState: SalesDispatchActionState = { ok: false, message: "" };
