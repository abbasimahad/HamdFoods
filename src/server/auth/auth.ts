import "server-only";

import { prismaAdapter } from "@better-auth/prisma-adapter";
import { betterAuth } from "better-auth";

import { prisma } from "@/server/db/prisma";
import { serverEnv } from "@/server/server-env";

import { createAuthOptions } from "./auth-options";
import { createActiveSessionBeforeHook } from "./active-session-policy";

function createFactoryAuth(allowSignUp: boolean) {
  return betterAuth({
    ...createAuthOptions({ allowSignUp }),
    appName: "Hamd Foods ERP",
    baseURL: serverEnv.BETTER_AUTH_URL,
    secret: serverEnv.BETTER_AUTH_SECRET,
    trustedOrigins: [serverEnv.BETTER_AUTH_URL],
    database: prismaAdapter(prisma, { provider: "postgresql", transaction: true }),
    databaseHooks: {
      session: {
        create: {
          before: createActiveSessionBeforeHook(async (userId) => {
            const user = await prisma.user.findUnique({
              where: { id: userId },
              select: { active: true },
            });
            return user?.active ?? false;
          }),
        },
      },
    },
  });
}

export const auth = createFactoryAuth(false);

// This instance is server-only and never mounted as an HTTP handler.
export const provisioningAuth = createFactoryAuth(true);
