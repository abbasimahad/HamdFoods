"use client";

export type SalesActionState = { ok: boolean; message: string };
export type SalesAction = (
  state: SalesActionState,
  formData: FormData,
) => Promise<SalesActionState>;
export const initialSalesActionState: SalesActionState = { ok: false, message: "" };
