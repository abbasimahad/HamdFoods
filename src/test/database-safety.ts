export class TestDatabaseSafetyError extends Error {}

export function requireSafeTestDatabaseUrl(value: string | undefined, developmentUrl?: string) {
  if (!value) throw new TestDatabaseSafetyError("TEST_DATABASE_URL is required.");
  if (developmentUrl && value === developmentUrl)
    throw new TestDatabaseSafetyError("TEST_DATABASE_URL must not equal DATABASE_URL.");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TestDatabaseSafetyError("TEST_DATABASE_URL must be a valid PostgreSQL URL.");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw new TestDatabaseSafetyError("TEST_DATABASE_URL must use PostgreSQL.");
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!/(?:^|[-_])test(?:$|[-_])/i.test(databaseName))
    throw new TestDatabaseSafetyError(
      "The integration database name must be explicitly test-only.",
    );
  return value;
}
