import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { genericOAuth, username } from "better-auth/plugins";
import type { Database } from "@/shared/db";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
} from "../domain/credentials";
import { EXTERNAL_PROVIDER_ID } from "../domain/external-sign-in";
import { authAccounts, authSessions, authUsers, authVerifications } from "./schema";

const DAY_IN_SECONDS = 24 * 60 * 60;

/**
 * Better Auth, configured for identity only (ADR 0012): usernames, password hashes, sessions.
 * Only this module's infrastructure uses it; everything else goes through IdentityProvider.
 */
/** The provider's settings (the composition root passes `config.oidc`). */
export type OidcSettings = Readonly<{
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
}>;

export function createAuth(options: {
  db: Database;
  secret: string;
  appUrl: string;
  /** Sign-in with Authentik; absent means passwords only (design doc 69). */
  oidc?: OidcSettings;
}) {
  const { oidc } = options;
  return betterAuth({
    secret: options.secret,
    baseURL: options.appUrl,
    database: drizzleAdapter(options.db, {
      provider: "pg",
      // Better Auth's model names → our auth_* tables.
      schema: {
        user: authUsers,
        session: authSessions,
        account: authAccounts,
        verification: authVerifications,
      },
    }),
    emailAndPassword: {
      enabled: true,
      // Nobody signs up through Better Auth directly: registration goes through our
      // registerPlayer use case, with its invite rules.
      disableSignUp: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
    },
    session: {
      expiresIn: 30 * DAY_IN_SECONDS, // design doc 02: 30 days...
      updateAge: DAY_IN_SECONDS, // ...renewed (at most once a day) while in use
    },
    // Authentik, when it is set up (design doc 69, section 4). A sign-in links to an existing
    // player and never makes one (`disableSignUp` below). A player links themselves from the
    // Account page (a different email is fine, they are signed in), or an admin sets their
    // verified email, and then the provider is trusted to vouch for it: the owner's Authentik
    // has no self-enrollment (open question 9, answered yes).
    ...(oidc === undefined
      ? {}
      : {
          account: {
            // The provider's tokens aren't used after the sign-in; don't keep them readable.
            encryptOAuthTokens: true,
            accountLinking: {
              enabled: true,
              trustedProviders: [EXTERNAL_PROVIDER_ID],
              allowDifferentEmails: true,
            },
          },
        }),
    plugins: [
      username({ minUsernameLength: USERNAME_MIN_LENGTH, maxUsernameLength: USERNAME_MAX_LENGTH }),
      ...(oidc === undefined
        ? []
        : [
            genericOAuth({
              config: [
                {
                  providerId: EXTERNAL_PROVIDER_ID,
                  discoveryUrl: `${oidc.issuerUrl.replace(/\/+$/, "")}/.well-known/openid-configuration`,
                  clientId: oidc.clientId,
                  clientSecret: oidc.clientSecret,
                  scopes: ["openid", "email", "profile"],
                  pkce: true,
                  // Fail closed: no issuer or keys in discovery means no sign-in, not an
                  // unchecked ID token.
                  requireIdTokenVerification: true,
                  disableSignUp: true,
                },
              ],
            }),
          ]),
      nextCookies(), // lets our server actions set the session cookie
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
