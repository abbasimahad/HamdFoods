import { seedAccessControl } from "../src/modules/access/application/seed-access-control";
import { PrismaAccessRepository } from "../src/server/access/prisma-access-repository";

await seedAccessControl(new PrismaAccessRepository());
console.log("Default permissions and roles are synchronized.");
