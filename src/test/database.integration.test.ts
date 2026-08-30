import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";

describe("dedicated integration database", () => {
  afterAll(async () => prisma.$disconnect());

  it("connects only to the guarded test database and exposes the migrated core schema", async () => {
    const [database] = await prisma.$queryRaw<Array<{ database: string }>>`
      SELECT current_database() AS database
    `;
    const [schema] = await prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT to_regclass('public.inventory_movement') IS NOT NULL AS exists
    `;
    expect(database?.database).toMatch(/(?:^|[-_])test(?:$|[-_])/i);
    expect(schema?.exists).toBe(true);
  });
});
