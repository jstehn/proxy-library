import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { username } from "better-auth/plugins";
import type { Database } from "@/shared/db";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
} from "../domain/credentials";
import { authAccounts, authSessions, authUsers, authVerifications } from "./schema";

const DAY_IN_SECONDS = 24 * 60 * 60;

/**
 * Better Auth, configured for identity only (ADR 0012): usernames, password hashes, sessions.
 * Only this module's infrastructure uses it; everything else goes through IdentityProvider.
 */
export function createAuth(options: { db: Database; secret: string; appUrl: string }) {
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
    plugins: [
      username({ minUsernameLength: USERNAME_MIN_LENGTH, maxUsernameLength: USERNAME_MAX_LENGTH }),
      nextCookies(), // lets our server actions set the session cookie
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
