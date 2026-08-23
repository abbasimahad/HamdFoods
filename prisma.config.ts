import "dotenv/config";

import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx --conditions=react-server --env-file=.env scripts/seed-all.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
