export type AuthenticationGateway = {
  signIn(input: {
    email: string;
    password: string;
    rememberMe: boolean;
  }): Promise<{ userId: string } | null>;
  isActive(userId: string): Promise<boolean>;
  revokeCurrentSession(): Promise<void>;
};

export type AuthenticationResult = { ok: true } | { ok: false; message: string };

export async function authenticateUser(
  input: { email: string; password: string; rememberMe: boolean },
  gateway: AuthenticationGateway,
): Promise<AuthenticationResult> {
  const invalid: AuthenticationResult = { ok: false, message: "Invalid email or password." };
  let signedIn = false;

  try {
    const result = await gateway.signIn(input);
    if (!result) return invalid;
    signedIn = true;
    if (!(await gateway.isActive(result.userId))) {
      await gateway.revokeCurrentSession();
      return invalid;
    }
    return { ok: true };
  } catch {
    if (signedIn) {
      await gateway.revokeCurrentSession().catch(() => undefined);
    }
    return invalid;
  }
}
