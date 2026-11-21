import { readPage } from "@/server/page-instance";

// The one Better Auth route that is mounted (ADR 0028, amending ADR 0012): where Authentik sends
// the browser back after it signed the player in. Better Auth checks the state, the PKCE
// verifier and the ID token (issuer, audience, signature, expiry, nonce) and answers with the
// session cookie and a redirect to /sign-in/finish. Nothing else under /api/auth exists, so
// Better Auth's other endpoints stay unreachable.

export async function GET(request: Request): Promise<Response> {
  const { capabilities } = await readPage({ allowVisitors: true });
  return capabilities.accounts.handleExternalCallback(request);
}
