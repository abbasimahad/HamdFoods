export type RoleActionState = { status: "idle" | "success" | "error"; message: string };
export const initialRoleActionState: RoleActionState = { status: "idle", message: "" };
