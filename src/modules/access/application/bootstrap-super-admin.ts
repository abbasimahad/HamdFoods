import type { BootstrapEnv } from "@/server/bootstrap-env";

import type { BootstrapStore } from "./ports";

export type BootstrapResult = { userId: string; created: boolean };

export async function bootstrapSuperAdmin(
  input: BootstrapEnv,
  store: BootstrapStore,
): Promise<BootstrapResult> {
  const email = input.email.trim().toLowerCase();
  let user = await store.findUserByEmail(email);
  const created = !user;
  if (!user) {
    user = await store.createCredentialUser({
      name: input.name.trim(),
      email,
      password: input.password,
    });
  }
  await store.setUserActive(user.id, true);
  await store.ensureUserRole(user.id, "SUPER_ADMIN");
  return { userId: user.id, created };
}
