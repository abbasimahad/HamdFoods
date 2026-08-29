"use client";

export type SalesOrderActionState = { ok: boolean; message: string };
export type SalesOrderAction = (
  state: SalesOrderActionState,
  formData: FormData,
) => Promise<SalesOrderActionState>;
export const initialSalesOrderActionState: SalesOrderActionState = { ok: false, message: "" };
