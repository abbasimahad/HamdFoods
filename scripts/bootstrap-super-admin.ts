import { bootstrapSuperAdmin } from "../src/modules/access/application/bootstrap-super-admin";
import { seedAccessControl } from "../src/modules/access/application/seed-access-control";
import { PrismaAccessRepository } from "../src/server/access/prisma-access-repository";
import { parseBootstrapEnv } from "../src/server/bootstrap-env";

const repository = new PrismaAccessRepository();
await seedAccessControl(repository);
const result = await bootstrapSuperAdmin(parseBootstrapEnv(process.env), repository);
console.log(
  result.created
    ? `SUPER_ADMIN bootstrap created user ${result.userId}.`
    : `SUPER_ADMIN bootstrap reconciled existing user ${result.userId}.`,
);
