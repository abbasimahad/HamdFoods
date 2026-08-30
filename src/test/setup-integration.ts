import { requireSafeTestDatabaseUrl } from "./database-safety";

process.env.DATABASE_URL = requireSafeTestDatabaseUrl(
  process.env.TEST_DATABASE_URL,
  process.env.DATABASE_URL,
);
