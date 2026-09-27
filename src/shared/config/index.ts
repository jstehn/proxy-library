import { z } from "zod";

// The only file that reads process.env (lint-enforced). Composition roots call
// loadConfig() once and pass the pieces they need to the code they build.

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z
    .string({ error: "is required (direnv sets it; run `direnv allow`)" })
    .regex(/^postgres(ql)?:\/\//, "must be a postgres:// connection URL"),
  AUTH_SECRET: z
    .string({ error: "is required (direnv generates one in .dev/auth-secret)" })
    .min(32, "must be at least 32 characters"),
  APP_URL: z.url({ error: "must be the app's public URL, e.g. http://localhost:3000" }),
});

export type Config = Readonly<{
  nodeEnv: "development" | "test" | "production";
  databaseUrl: string;
  /** Signs session cookies. Changing it signs everyone out. */
  authSecret: string;
  /** Where players open the app, e.g. http://localhost:3000. */
  appUrl: string;
}>;

/** Parse the environment once at startup and fail fast with a readable message. */
export function loadConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
  }
  return {
    nodeEnv: parsed.data.NODE_ENV,
    databaseUrl: parsed.data.DATABASE_URL,
    authSecret: parsed.data.AUTH_SECRET,
    appUrl: parsed.data.APP_URL,
  };
}
