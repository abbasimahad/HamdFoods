import { spawnSync } from "node:child_process";
import path from "node:path";

import { z } from "zod";

import {
  listLocalRecoveryAccounts,
  recoverLocalAdministrativeAccount,
} from "../src/modules/access/application/local-account-recovery";
import { PrismaAccountSecurityRepository } from "../src/server/access/prisma-account-security-repository";
import { prisma } from "../src/server/db/prisma";
import { isAdministratorHighIntegrity } from "../src/server/operations/local-account-recovery";

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list") }),
  z.object({
    action: z.literal("recover"),
    userId: z.string().min(1),
    loginEmail: z.email().optional(),
    password: z.string().min(8).max(128).optional(),
    confirmedPassword: z.string().min(8).max(128).optional(),
  }),
]);

try {
  assertLocalElevatedExecution();
  if (process.argv.slice(2).length) {
    throw new Error("Account recovery does not accept command-line arguments.");
  }
  const payload = requestSchema.parse(JSON.parse(await readStandardInput()));
  const repository = new PrismaAccountSecurityRepository();
  if (payload.action === "list") {
    console.log(JSON.stringify({ accounts: await listLocalRecoveryAccounts(repository) }));
  } else {
    const result = await recoverLocalAdministrativeAccount(repository, {
      userId: payload.userId,
      ...(payload.loginEmail === undefined ? {} : { loginEmail: payload.loginEmail }),
      ...(payload.password === undefined ? {} : { password: payload.password }),
      ...(payload.confirmedPassword === undefined
        ? {}
        : { confirmedPassword: payload.confirmedPassword }),
    });
    if (!result.ok) throw new Error(`Recovery was rejected: ${result.reason}.`);
    console.log(JSON.stringify({ status: "updated" }));
  }
} catch {
  console.error("Account recovery failed closed. No credential values were logged.");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect().catch(() => undefined);
}

function assertLocalElevatedExecution() {
  if (process.platform !== "win32") throw new Error("Account recovery is Windows-only.");
  const whoami = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "whoami.exe");
  const result = spawnSync(whoami, ["/groups"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000,
  });
  if (result.status !== 0 || !isAdministratorHighIntegrity(result.stdout ?? "")) {
    throw new Error("Windows Administrator high-integrity elevation is required.");
  }
}

async function readStandardInput() {
  let value = "";
  for await (const chunk of process.stdin) {
    value += String(chunk);
    if (value.length > 32_768) throw new Error("Recovery input is too large.");
  }
  if (!value.trim()) throw new Error("Recovery input is required on standard input.");
  return value;
}
