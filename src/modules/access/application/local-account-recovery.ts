export type LocalRecoveryAccount = {
  id: string;
  displayName: string;
  loginEmail: string;
  roleCodes: readonly string[];
  status: "Active";
};

export type LocalAccountRecoveryStore = {
  listAdministrativeAccounts(): Promise<readonly LocalRecoveryAccount[]>;
  recoverAdministrativeAccount(
    userId: string,
    changes: { loginEmail?: string; password?: string },
  ): Promise<"updated" | "not-found" | "duplicate-email" | "not-administrative">;
};

export async function listLocalRecoveryAccounts(
  store: LocalAccountRecoveryStore,
): Promise<readonly LocalRecoveryAccount[]> {
  const accounts = await store.listAdministrativeAccounts();
  return accounts.map((account) => ({
    id: account.id,
    displayName: account.displayName,
    loginEmail: account.loginEmail,
    roleCodes: [...account.roleCodes],
    status: account.status,
  }));
}

export type LocalRecoveryResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "invalid-request"
        | "password-mismatch"
        | "not-found"
        | "duplicate-email"
        | "not-administrative";
    };

export async function recoverLocalAdministrativeAccount(
  store: LocalAccountRecoveryStore,
  input: {
    userId: string;
    loginEmail?: string;
    password?: string;
    confirmedPassword?: string;
  },
): Promise<LocalRecoveryResult> {
  const loginEmail = input.loginEmail?.trim().toLowerCase();
  const password = input.password;
  if (!input.userId || (!loginEmail && !password)) return { ok: false, reason: "invalid-request" };
  if (password !== undefined && password !== input.confirmedPassword) {
    return { ok: false, reason: "password-mismatch" };
  }
  const result = await store.recoverAdministrativeAccount(input.userId, {
    ...(loginEmail ? { loginEmail } : {}),
    ...(password ? { password } : {}),
  });
  return result === "updated" ? { ok: true } : { ok: false, reason: result };
}
