import { isAPIError } from "better-auth/api";
import { err, ok, UserId } from "@/shared/kernel";
import type { IdentityProvider } from "../application/ports";
import type { Auth } from "./better-auth";

// Better Auth insists every user has an email. We never send email, so we store an address
// on the reserved ".invalid" domain (RFC 2606), which can never receive mail.
const PLACEHOLDER_EMAIL_DOMAIN = "players.invalid";

/** IdentityProvider implemented with Better Auth (ADR 0012). */
export function betterAuthIdentityProvider(auth: Auth): IdentityProvider {
  return {
    async createUser({ username, displayName, password }) {
      // Better Auth's own sign-up endpoint is switched off (see better-auth.ts), so we use
      // the same building blocks it uses internally: hash, create user, link credentials.
      const context = await auth.$context;
      const existing = await context.adapter.findOne({
        model: "user",
        where: [{ field: "username", value: username }],
      });
      if (existing !== null) return err({ kind: "UsernameTaken" });

      const passwordHash = await context.password.hash(password);
      const user = await context.internalAdapter.createUser(
        {
          email: `${username}@${PLACEHOLDER_EMAIL_DOMAIN}`,
          name: displayName,
          username,
          displayUsername: username,
          emailVerified: false,
        },
        { method: "email-password" },
      );
      await context.internalAdapter.linkAccount({
        userId: user.id,
        providerId: "credential",
        accountId: user.id,
        password: passwordHash,
      });
      return ok(UserId.of(user.id));
    },

    async deleteUser(userId) {
      const context = await auth.$context;
      await context.internalAdapter.deleteUser(userId);
    },

    async signIn({ username, password }, requestHeaders) {
      try {
        const response = await auth.api.signInUsername({
          body: { username, password },
          headers: requestHeaders,
        });
        if (response === null) return err({ kind: "InvalidCredentials" });
        return ok(UserId.of(response.user.id));
      } catch (error) {
        if (isAPIError(error) && error.statusCode === 401) {
          return err({ kind: "InvalidCredentials" });
        }
        throw error;
      }
    },

    async signOut(requestHeaders) {
      await auth.api.signOut({ headers: requestHeaders });
    },

    async currentUserId(requestHeaders) {
      const session = await auth.api.getSession({ headers: requestHeaders });
      return session === null ? null : UserId.of(session.user.id);
    },

    async changePassword({ currentPassword, newPassword }, requestHeaders) {
      try {
        await auth.api.changePassword({
          body: { currentPassword, newPassword, revokeOtherSessions: true },
          headers: requestHeaders,
        });
        return ok();
      } catch (error) {
        if (isAPIError(error) && (error.statusCode === 400 || error.statusCode === 401)) {
          return err({ kind: "InvalidCredentials" });
        }
        throw error;
      }
    },

    async setPassword(userId, password) {
      const context = await auth.$context;
      const passwordHash = await context.password.hash(password);
      await context.internalAdapter.updatePassword(userId, passwordHash);
    },

    async endAllSessions(userId) {
      const context = await auth.$context;
      await context.internalAdapter.deleteUserSessions(userId);
    },
  };
}
