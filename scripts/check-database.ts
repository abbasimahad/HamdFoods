import { prisma } from "../src/server/db/prisma";
import { probeDatabase } from "../src/server/db/probe-database";

try {
  await probeDatabase();
  console.log("Database check passed: Prisma completed a PostgreSQL query.");
} catch {
  console.error("Database check failed: Prisma could not complete a PostgreSQL query.");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
