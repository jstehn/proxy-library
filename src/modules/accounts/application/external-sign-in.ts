import { err, ok, type Result } from "@/shared/kernel";
import type { EmailInvalid, EmailTaken, Forbidden, PlayerNotFound } from "../domain/errors";
import { parseEmail, placeholderEmail } from "../domain/external-sign-in";
import type { Actor } from "../domain/player";
import { requireAdmin } from "../domain/rules";
import type { AccountsDependencies } from "./ports";

// Sign-in through Authentik (design doc 69, section 4). Better Auth runs the OpenID Connect round
// trip; these use cases add our rules. A sign-in only ever finds an existing player: it never
// makes one, so being given an Authentik account doesn't by itself admit anyone (an invite is
// still needed), and `is_admin` is never read from the provider.

export type SetPlayerEmailError = Forbidden | PlayerNotFound | EmailInvalid | EmailTaken;

/** Where the browser goes to sign in; null when the app has no provider set up. */
export function makeStartExternalSignIn(dependencies: AccountsDependencies) {
  const { identity } = dependencies;

  /** `next` is already a safe path (`safeNextPath`): it rides along to the finish route. */
  function startExternalSignIn(
    input: { next: string | null },
    requestHeaders: Headers,
  ): Promise<string | null> {
    const finish =
      input.next === null
        ? "/sign-in/finish"
        : `/sign-in/finish?next=${encodeURIComponent(input.next)}`;
    return identity.startExternalSignIn(
      { callbackPath: finish, errorPath: "/sign-in" },
      requestHeaders,
    );
  }

  return startExternalSignIn;
}

/** A signed-in player links their Authentik account (the safe, always-allowed way to link). */
export function makeStartExternalLink(dependencies: AccountsDependencies) {
  const { identity } = dependencies;

  // The actor argument is the access rule: only a signed-in player can link, to themselves.
  function startExternalLink(_actor: Actor, requestHeaders: Headers): Promise<string | null> {
    return identity.startExternalLink(
      { callbackPath: "/account", errorPath: "/account" },
      requestHeaders,
    );
  }

  return startExternalLink;
}

export function makeUnlinkExternal(dependencies: AccountsDependencies) {
  const { identity } = dependencies;

  async function unlinkExternal(_actor: Actor, requestHeaders: Headers): Promise<void> {
    await identity.unlinkExternal(requestHeaders);
  }

  return unlinkExternal;
}

/** The provider's redirect back (`GET /api/auth/callback/:provider`, ADR 0028). */
export function makeHandleExternalCallback(dependencies: AccountsDependencies) {
  const { identity } = dependencies;

  function handleExternalCallback(request: Request): Promise<Response> {
    return identity.handleExternalCallback(request);
  }

  return handleExternalCallback;
}

/**
 * An admin sets a player's real email, verified on the admin's say-so. The player's first
 * Authentik sign-in then links to them when Authentik's email matches (design doc 69, 4.2). An
 * empty email puts the placeholder back and unverifies it.
 */
export function makeSetPlayerEmail(dependencies: AccountsDependencies) {
  const { unitOfWork, identity } = dependencies;

  async function setPlayerEmail(
    admin: Actor,
    input: { userId: Actor["userId"]; email: string },
  ): Promise<Result<void, SetPlayerEmailError>> {
    const allowed = requireAdmin(admin);
    if (!allowed.ok) return allowed;
    const found = await unitOfWork.run(async ({ players }) =>
      ok(await players.findById(input.userId)),
    );
    const player = found.ok ? found.value : null;
    if (player === null) return err({ kind: "PlayerNotFound" });

    if (input.email.trim() === "") {
      return identity.setEmail(player.userId, {
        email: placeholderEmail(player.username),
        verified: false,
      });
    }
    const parsed = parseEmail(input.email);
    if (!parsed.ok) return err({ kind: "EmailInvalid", reason: parsed.reason });
    return identity.setEmail(player.userId, { email: parsed.email, verified: true });
  }

  return setPlayerEmail;
}
