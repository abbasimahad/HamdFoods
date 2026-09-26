export type UserActionState = { status: "idle" | "success" | "error"; message: string };
export const initialUserActionState: UserActionState = { status: "idle", message: "" };
