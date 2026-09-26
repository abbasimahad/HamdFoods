export type AccountSecurityActionState = {
  status: "idle" | "success" | "error";
  message: string;
  signedOut?: boolean;
};
export const initialAccountSecurityState: AccountSecurityActionState = {
  status: "idle",
  message: "",
};
