import type { ApplicationPrincipal } from "../domain/principal";

export type AccountSecurityStore = {
  updateDisplayName(actorId: string, displayName: string): Promise<void>;
  changeLoginEmail(
    actorId: string,
    newEmail: string,
    currentPassword: string,
  ): Promise<"updated" | "invalid-current-password" | "duplicate-email" | "not-found">;
  changePassword(
    actorId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<"updated" | "invalid-current-password" | "not-found">;
};

export type AccountSecurityResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "invalid-name"
        | "invalid-current-password"
        | "duplicate-email"
        | "password-mismatch"
        | "not-found";
    };

export async function updateOwnDisplayName(
  actor: ApplicationPrincipal,
  displayName: string,
  store: AccountSecurityStore,
): Promise<AccountSecurityResult> {
  const normalized = displayName.trim();
  if (!normalized) return { ok: false, reason: "invalid-name" };
  await store.updateDisplayName(actor.id, normalized);
  return { ok: true };
}

export async function changeOwnPassword(
  actor: ApplicationPrincipal,
  currentPassword: string,
  newPassword: string,
  confirmedPassword: string,
  store: AccountSecurityStore,
): Promise<AccountSecurityResult> {
  if (newPassword !== confirmedPassword) return { ok: false, reason: "password-mismatch" };
  const result = await store.changePassword(actor.id, currentPassword, newPassword);
  return result === "updated" ? { ok: true } : { ok: false, reason: result };
}

export async function changeOwnLoginEmail(
  actor: ApplicationPrincipal,
  newEmail: string,
  currentPassword: string,
  store: AccountSecurityStore,
): Promise<AccountSecurityResult> {
  const result = await store.changeLoginEmail(
    actor.id,
    newEmail.trim().toLowerCase(),
    currentPassword,
  );
  return result === "updated" ? { ok: true } : { ok: false, reason: result };
}
