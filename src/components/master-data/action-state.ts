export type MasterActionState = { status: "idle" | "success" | "error"; message: string };
export const initialMasterActionState: MasterActionState = { status: "idle", message: "" };
export type MasterAction = (
  state: MasterActionState,
  formData: FormData,
) => Promise<MasterActionState>;
