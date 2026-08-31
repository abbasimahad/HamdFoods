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
    POSTGRES_USER: z.string().trim().min(1).optional(),
    POSTGRES_PASSWORD: z.string().trim().min(1).optional(),
    POSTGRES_DB: z.string().trim().min(1).optional(),
  })
  .superRefine((value, context) => {
    if (value.APP_ENV !== "production") return;

    for (const name of ["POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB"] as const) {
      if (!value[name])
        context.addIssue({
          code: "custom",
          message: "is required for production Compose configuration",
          path: [name],
        });
    }

    if (new URL(value.DATABASE_URL).hostname !== "database")
      context.addIssue({
        code: "custom",
        message: "must use the private Compose database hostname in production",
        path: ["DATABASE_URL"],
      });
  });

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
