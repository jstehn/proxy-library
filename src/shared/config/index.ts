import { z } from "zod";

// The only file that reads process.env (lint-enforced). Composition roots call
// loadConfig() once and pass the pieces they need to the code they build.

// Every setting below is set by .envrc. If one is reported missing right after an update, the
// running terminal has the old environment: run `direnv reload`, then restart the process.
const FROM_ENVRC = "is required (.envrc sets it: run `direnv reload`, then restart)";

// Sign-in with an OpenID Connect provider such as Authentik (design doc 69, section 11): either
// all three of these are set, or none. The button name is optional.
const OIDC_VARIABLES = ["OIDC_ISSUER_URL", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET"] as const;

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z
      .string({ error: "is required (direnv sets it; run `direnv allow`)" })
      .regex(/^postgres(ql)?:\/\//, "must be a postgres:// connection URL"),
    AUTH_SECRET: z
      .string({ error: "is required (direnv generates one in .dev/auth-secret)" })
      .min(32, "must be at least 32 characters"),
    APP_URL: z.url({ error: "must be the app's public URL, e.g. http://localhost:3000" }),
    IMAGE_CACHE_DIR: z.string({ error: FROM_ENVRC }).min(1),
    SYNC_CACHE_DIR: z.string({ error: FROM_ENVRC }).min(1),
    SEALED_CONTENTS_DIR: z.string().min(1).default("data/sealed-contents"),
    SYNC_TIME: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must be a 24-hour time like 04:00")
      .default("04:00"),
    REDDIT_CLIENT_ID: z.string().optional(),
    REDDIT_CLIENT_SECRET: z.string().optional(),
    BRAVE_SEARCH_API_KEY: z.string().optional(),
    SEARXNG_URL: z.string().optional(),
    OIDC_ISSUER_URL: z.string().optional(),
    OIDC_CLIENT_ID: z.string().optional(),
    OIDC_CLIENT_SECRET: z.string().optional(),
    OIDC_PROVIDER_NAME: z.string().optional(),
  })
  .superRefine((env, context) => {
    const isSet = OIDC_VARIABLES.filter((name) => env[name]);
    if (isSet.length === 0) return;
    for (const name of OIDC_VARIABLES.filter((variable) => !env[variable])) {
      context.addIssue({
        code: "custom",
        path: [name],
        message: `is required when ${isSet.join(" and ")} is set (all of ${OIDC_VARIABLES.join(", ")}, or none)`,
      });
    }
    const issuer = env.OIDC_ISSUER_URL;
    const isLocal =
      issuer !== undefined && /^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(issuer);
    if (issuer && !z.url().safeParse(issuer).success) {
      context.addIssue({ code: "custom", path: ["OIDC_ISSUER_URL"], message: "must be a URL" });
    } else if (issuer && !issuer.startsWith("https://") && !isLocal) {
      context.addIssue({
        code: "custom",
        path: ["OIDC_ISSUER_URL"],
        message: "must be an https URL (http only for localhost)",
      });
    }
  });

export type Config = Readonly<{
  nodeEnv: "development" | "test" | "production";
  databaseUrl: string;
  /** Signs session cookies. Changing it signs everyone out. */
  authSecret: string;
  /** Where players open the app, e.g. http://localhost:3000. */
  appUrl: string;
  /** Where downloaded card images are kept. */
  imageCacheDir: string;
  /** Where the sync keeps its downloads (Scryfall's bulk file). */
  syncCacheDir: string;
  /** Where the files giving contents to products MTGJSON hasn't filled in are (ADR 0031). */
  sealedContentsDir: string;
  /** When the nightly sync runs, in the server's time zone. */
  syncTime: Readonly<{ hour: number; minute: number }>;
  /** Optional Reddit OAuth app credentials for oauth.reddit.com. */
  redditClientId?: string;
  redditClientSecret?: string;
  /** Optional Brave Search API key for Reddit web search. */
  braveSearchApiKey?: string;
  /** Optional self-hosted SearXNG base URL (e.g. http://searxng:8080) for Reddit web search. */
  searxngUrl?: string;
  /** Optional sign-in with Authentik or another OpenID Connect provider (design doc 69). */
  oidc?: OidcConfig;
}>;

export type OidcConfig = Readonly<{
  /** The provider's issuer URL; discovery is read from `<issuer>/.well-known/openid-configuration`. */
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  /** What the sign-in button calls it. */
  providerName: string;
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
    imageCacheDir: parsed.data.IMAGE_CACHE_DIR,
    syncCacheDir: parsed.data.SYNC_CACHE_DIR,
    sealedContentsDir: parsed.data.SEALED_CONTENTS_DIR,
    syncTime: {
      hour: Number(parsed.data.SYNC_TIME.slice(0, 2)),
      minute: Number(parsed.data.SYNC_TIME.slice(3, 5)),
    },
    ...(parsed.data.REDDIT_CLIENT_ID ? { redditClientId: parsed.data.REDDIT_CLIENT_ID } : {}),
    ...(parsed.data.REDDIT_CLIENT_SECRET
      ? { redditClientSecret: parsed.data.REDDIT_CLIENT_SECRET }
      : {}),
    ...(parsed.data.BRAVE_SEARCH_API_KEY
      ? { braveSearchApiKey: parsed.data.BRAVE_SEARCH_API_KEY }
      : {}),
    ...(parsed.data.SEARXNG_URL ? { searxngUrl: parsed.data.SEARXNG_URL } : {}),
    ...(parsed.data.OIDC_ISSUER_URL && parsed.data.OIDC_CLIENT_ID && parsed.data.OIDC_CLIENT_SECRET
      ? {
          oidc: {
            issuerUrl: parsed.data.OIDC_ISSUER_URL,
            clientId: parsed.data.OIDC_CLIENT_ID,
            clientSecret: parsed.data.OIDC_CLIENT_SECRET,
            providerName: parsed.data.OIDC_PROVIDER_NAME || "Authentik",
          },
        }
      : {}),
  };
}
