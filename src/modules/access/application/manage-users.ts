import { hasPermission, type ApplicationPrincipal } from "../domain/principal";

export type ManagedUserInput = {
  name: string;
  email: string;
  password: string;
  active: boolean;
  roleCodes: readonly string[];
};

export type UserAccessState = { active: boolean; roleCodes: readonly string[] };
export type AtomicUserAccessResult =
  "updated" | "protected-role" | "last-super-admin" | "not-found";

export type UserManagementStore = {
  roleCodesExist(roleCodes: readonly string[]): Promise<boolean>;
  createUser(actorId: string, input: ManagedUserInput): Promise<{ id: string; email: string }>;
  replaceUserRolesPreservingSuperAdmin(
    actorId: string,
    userId: string,
    roleCodes: readonly string[],
  ): Promise<AtomicUserAccessResult>;
  getUserAccessState(userId: string): Promise<UserAccessState | null>;
  setUserActivePreservingSuperAdmin(
    actorId: string,
    userId: string,
    active: boolean,
  ): Promise<AtomicUserAccessResult>;
};

export type UserMutationResult =
  | { ok: true; userId?: string }
  | {
      ok: false;
      reason:
        | "forbidden"
        | "invalid-roles"
        | "protected-role"
        | "self-change"
        | "last-super-admin"
        | "not-found";
    };

function isSuperAdmin(principal: ApplicationPrincipal) {
  return principal.roleCodes.includes("SUPER_ADMIN");
}

export async function createManagedUser(
  actor: ApplicationPrincipal,
  input: ManagedUserInput,
  store: UserManagementStore,
): Promise<UserMutationResult> {
  if (!hasPermission(actor, "users.manage")) return { ok: false, reason: "forbidden" };
  const roleCodes = [...new Set(input.roleCodes)];
  if (roleCodes.length === 0 || !(await store.roleCodesExist(roleCodes))) {
    return { ok: false, reason: "invalid-roles" };
  }
  if (roleCodes.includes("SUPER_ADMIN") && !isSuperAdmin(actor)) {
    return { ok: false, reason: "protected-role" };
  }
  const user = await store.createUser(actor.id, {
    ...input,
    name: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    roleCodes,
  });
  return { ok: true, userId: user.id };
}

export async function replaceUserRoles(
  actor: ApplicationPrincipal,
  userId: string,
  submittedRoleCodes: readonly string[],
  store: UserManagementStore,
): Promise<UserMutationResult> {
  if (!hasPermission(actor, "users.manage")) return { ok: false, reason: "forbidden" };
  const roleCodes = [...new Set(submittedRoleCodes)];
  if (roleCodes.length === 0 || !(await store.roleCodesExist(roleCodes))) {
    return { ok: false, reason: "invalid-roles" };
  }
  const target = await store.getUserAccessState(userId);
  if (!target) return { ok: false, reason: "not-found" };
  if (userId === actor.id && !sameValues(target.roleCodes, roleCodes)) {
    return { ok: false, reason: "self-change" };
  }
  const touchesSuperAdmin =
    target.roleCodes.includes("SUPER_ADMIN") || roleCodes.includes("SUPER_ADMIN");
  if (touchesSuperAdmin && !isSuperAdmin(actor)) {
    return { ok: false, reason: "protected-role" };
  }
  const result = await store.replaceUserRolesPreservingSuperAdmin(actor.id, userId, roleCodes);
  if (result !== "updated") return { ok: false, reason: result };
  return { ok: true };
}

export async function setUserActive(
  actor: ApplicationPrincipal,
  userId: string,
  active: boolean,
  store: UserManagementStore,
): Promise<UserMutationResult> {
  if (!hasPermission(actor, "users.manage")) return { ok: false, reason: "forbidden" };
  if (userId === actor.id && !active) return { ok: false, reason: "self-change" };
  const target = await store.getUserAccessState(userId);
  if (!target) return { ok: false, reason: "not-found" };
  if (target.roleCodes.includes("SUPER_ADMIN") && !isSuperAdmin(actor)) {
    return { ok: false, reason: "protected-role" };
  }
  const result = await store.setUserActivePreservingSuperAdmin(actor.id, userId, active);
  if (result !== "updated") return { ok: false, reason: result };
  return { ok: true };
}

function sameValues(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value) => right.includes(value));
}
