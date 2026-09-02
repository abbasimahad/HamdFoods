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
    if (authUrl.protocol === "http:" && !isLoopbackHost(authUrl.hostname.toLowerCase()))
      context.addIssue({
        code: "custom",
        message:
          "must use loopback for HTTP production origins; use HTTPS for a future private origin",
        path: ["BETTER_AUTH_URL"],
      });
  });

function isLoopbackHost(host: string) {
  return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
}

export type ServerEnv = z.infer<typeof serverEnvSchema>;

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
