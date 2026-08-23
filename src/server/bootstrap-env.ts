export type BootstrapEnv = {
  name: string;
  email: string;
  password: string;
};

const bootstrapEnvSchema = z.object({
  BOOTSTRAP_ADMIN_NAME: z.string().trim().min(1),
  BOOTSTRAP_ADMIN_EMAIL: z.string().trim().toLowerCase().email(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(8).max(128),
});

export function parseBootstrapEnv(input: Record<string, string | undefined>): BootstrapEnv {
  const result = bootstrapEnvSchema.safeParse(input);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid bootstrap environment: ${details}`);
  }

  return {
    name: result.data.BOOTSTRAP_ADMIN_NAME,
    email: result.data.BOOTSTRAP_ADMIN_EMAIL,
    password: result.data.BOOTSTRAP_ADMIN_PASSWORD,
  };
}
import { z } from "zod";
