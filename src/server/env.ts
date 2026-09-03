import { z } from "zod";

const databaseUrlSchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) => {
      try {
        const protocol = new URL(value).protocol;
        return protocol === "postgresql:" || protocol === "postgres:";
      } catch {
        return false;
      }
    },
    { message: "must be a valid PostgreSQL connection URL" },
  );

const serverEnvSchema = z
  .object({
    APP_ENV: z.enum(["development", "test", "production"]),
    DATABASE_URL: databaseUrlSchema,
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url().refine((value) => {
      const protocol = new URL(value).protocol;
      return protocol === "http:" || protocol === "https:";
    }, "must use HTTP or HTTPS"),
    BETTER_AUTH_TRUSTED_ORIGINS: z
      .string()
      .trim()
      .optional()
      .transform((value, context) => {
        if (!value) return [];
        const origins = value.split(",").map((origin) => origin.trim());
        if (origins.some((origin) => !isExactProductionOrigin(origin))) {
          context.addIssue({
            code: "custom",
            message: "must contain only exact loopback HTTP or Tailscale HTTPS origins",
          });
          return z.NEVER;
        }
        return [...new Set(origins.map((origin) => new URL(origin).origin))];
      }),
    HOSTNAME: z.string().trim().min(1).optional(),
    PORT: z.string().trim().min(1).optional(),
  })
  .superRefine((value, context) => {
    if (value.APP_ENV !== "production") return;

    const databaseHost = new URL(value.DATABASE_URL).hostname.toLowerCase();
    if (!isLoopbackHost(databaseHost))
      context.addIssue({
        code: "custom",
        message: "must use a loopback PostgreSQL host in native production",
        path: ["DATABASE_URL"],
      });

    const authUrl = new URL(value.BETTER_AUTH_URL);
    if (!isExactProductionOrigin(value.BETTER_AUTH_URL))
      context.addIssue({
        code: "custom",
        message: "must be an exact loopback HTTP or Tailscale HTTPS origin",
        path: ["BETTER_AUTH_URL"],
      });

    if (authUrl.protocol === "http:" && !isLoopbackHost(authUrl.hostname.toLowerCase()))
      context.addIssue({
        code: "custom",
        message:
          "must use loopback for HTTP production origins; use HTTPS for a future private origin",
        path: ["BETTER_AUTH_URL"],
      });

    if (
      authUrl.protocol === "http:" &&
      value.HOSTNAME &&
      value.PORT &&
      (authUrl.hostname.toLowerCase() !== normalizeUrlHost(value.HOSTNAME) ||
        effectivePort(authUrl) !== value.PORT ||
        authUrl.pathname !== "/" ||
        authUrl.search !== "" ||
        authUrl.hash !== "")
    )
      context.addIssue({
        code: "custom",
        message: "must be the exact loopback HTTP origin defined by HOSTNAME and PORT",
        path: ["BETTER_AUTH_URL"],
      });

    if (!value.HOSTNAME || !isLoopbackHost(value.HOSTNAME.toLowerCase()))
      context.addIssue({
        code: "custom",
        message: "must be a loopback address in native production",
        path: ["HOSTNAME"],
      });

    const port = Number(value.PORT);
    if (!value.PORT || !Number.isSafeInteger(port) || port < 1 || port > 65_535)
      context.addIssue({
        code: "custom",
        message: "must be an integer between 1 and 65535 in native production",
        path: ["PORT"],
      });

    if (value.HOSTNAME && value.PORT) {
      const localOrigin = `http://${normalizeUrlHost(value.HOSTNAME)}:${value.PORT}`;
      if (authUrl.protocol === "https:" && !value.BETTER_AUTH_TRUSTED_ORIGINS.includes(localOrigin))
        context.addIssue({
          code: "custom",
          message: "must include the exact local maintenance origin",
          path: ["BETTER_AUTH_TRUSTED_ORIGINS"],
        });

      if (
        value.BETTER_AUTH_TRUSTED_ORIGINS.some(
          (origin) => origin.startsWith("http:") && origin !== localOrigin,
        )
      )
        context.addIssue({
          code: "custom",
          message: "loopback HTTP must match HOSTNAME and PORT",
          path: ["BETTER_AUTH_TRUSTED_ORIGINS"],
        });
    }
  });

function isLoopbackHost(host: string) {
  return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
}

function normalizeUrlHost(host: string) {
  const normalized = host.trim().toLowerCase();
  return normalized === "::1" ? "[::1]" : normalized;
}

function effectivePort(url: URL) {
  if (url.port) return url.port;
  return url.protocol === "http:" ? "80" : "443";
}

function isExactProductionOrigin(value: string) {
  if (value.includes("*")) return false;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash)
      return false;
    if (url.protocol === "http:") return isLoopbackHost(url.hostname.toLowerCase());
    return (
      url.protocol === "https:" &&
      effectivePort(url) === "443" &&
      isTailscaleDnsName(url.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

function isTailscaleDnsName(value: string) {
  const labels = value.split(".");
  return (
    labels.length > 2 &&
    labels.at(-2) === "ts" &&
    labels.at(-1) === "net" &&
    labels.slice(0, -2).every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  );
}

export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type NativeProductionEnv = ServerEnv & {
  APP_ENV: "production";
  HOSTNAME: string;
  PORT: string;
};

export function parseServerEnv(input: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(input);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
      .join("; ");

    throw new Error(`Invalid server environment: ${details}`);
  }

  return result.data;
}

export function parseNativeProductionEnv(
  input: Record<string, string | undefined>,
): NativeProductionEnv {
  const result = parseServerEnv(input);
  if (result.APP_ENV !== "production")
    throw new Error("Invalid server environment: APP_ENV must be production");
  return result as NativeProductionEnv;
}
