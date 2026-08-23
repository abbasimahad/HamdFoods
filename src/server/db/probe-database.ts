import { prisma } from "./prisma";

export async function probeDatabase(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}
