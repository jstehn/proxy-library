// Sign-in through an outside identity provider, Authentik (design doc 69, section 4): the names
// and rules that don't depend on Better Auth.

/** Better Auth's `auth_accounts.provider_id` for the Authentik link. */
export const EXTERNAL_PROVIDER_ID = "authentik";

/**
 * Better Auth insists every user has an email. Until an admin sets a real one a player has an
 * address on the reserved ".invalid" domain (RFC 2606), which can never receive mail.
 */
export const PLACEHOLDER_EMAIL_DOMAIN = "players.invalid";

const EMAIL_MAX_LENGTH = 254;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function placeholderEmail(username: string): string {
  return `${username}@${PLACEHOLDER_EMAIL_DOMAIN}`;
}

export function hasRealEmail(email: string): boolean {
  return !email.endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`);
}

/** The email as stored (trimmed, lower case), or why it can't be used. */
export function parseEmail(
  raw: string,
): { ok: true; email: string } | { ok: false; reason: string } {
  const email = raw.trim().toLowerCase();
  if (email.length > EMAIL_MAX_LENGTH) {
    return { ok: false, reason: `is longer than ${EMAIL_MAX_LENGTH} characters` };
  }
  if (!EMAIL.test(email)) return { ok: false, reason: "isn't an email address" };
  if (!hasRealEmail(email)) return { ok: false, reason: `can't be on ${PLACEHOLDER_EMAIL_DOMAIN}` };
  return { ok: true, email };
}
