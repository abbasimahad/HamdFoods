import { requireSafeTestDatabaseUrl } from "./database-safety";

export const PHASE27_TEST_DATABASE_URL =
  "postgresql://postgres@127.0.0.1:55433/factory_erp_test?schema=public";
export const PHASE28_RESTORE_DATABASE_URL =
  "postgresql://postgres@127.0.0.1:55433/factory_erp_restore_test?schema=public";
export const PHASE27_E2E_BASE_URL = "http://127.0.0.1:3417";
export const PHASE27_ADMIN = {
  name: "Phase 27 Administrator",
  email: "phase27.admin@example.test",
  password: "Phase27-Admin-Test-Only!",
} as const;
export const PHASE27_VIEWER = {
  name: "Phase 27 Viewer",
  email: "phase27.viewer@example.test",
  password: "Phase27-Viewer-Test-Only!",
} as const;

export function phase27TestDatabaseUrl() {
  const developmentUrl =
    process.env.DATABASE_URL === PHASE27_TEST_DATABASE_URL ? undefined : process.env.DATABASE_URL;
  return requireSafeTestDatabaseUrl(
    process.env.TEST_DATABASE_URL ?? PHASE27_TEST_DATABASE_URL,
    developmentUrl,
  );
}

export function phase27TestEnvironment() {
  const databaseUrl = phase27TestDatabaseUrl();
  return {
    ...process.env,
    APP_ENV: "test",
    DATABASE_URL: databaseUrl,
    TEST_DATABASE_URL: databaseUrl,
    RESTORE_DATABASE_URL: PHASE28_RESTORE_DATABASE_URL,
    BETTER_AUTH_SECRET: "phase27-test-only-auth-secret-not-for-production",
    BETTER_AUTH_URL: PHASE27_E2E_BASE_URL,
    BOOTSTRAP_ADMIN_NAME: PHASE27_ADMIN.name,
    BOOTSTRAP_ADMIN_EMAIL: PHASE27_ADMIN.email,
    BOOTSTRAP_ADMIN_PASSWORD: PHASE27_ADMIN.password,
  } satisfies NodeJS.ProcessEnv;
}
