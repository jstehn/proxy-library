import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { readPage } from "@/server/page-instance";
import { safeNextPath } from "@/server/next-path";

// Where Better Auth sends the browser after Authentik signed the player in (design doc 69,
// section 4.5). The session cookie is already set. A route, not a page, because a page can't end
// a session: a player who is disabled (or has no player row) gets the cookie cleared and is sent
// back to the sign-in page with the same words as a password sign-in.

export async function GET(request: Request): Promise<never> {
  const { actor, capabilities } = await readPage({ allowVisitors: true });
  if (actor === null) {
    await capabilities.accounts.signOut(await headers());
    redirect("/sign-in?error=disabled");
  }
  const next = safeNextPath(new URL(request.url).searchParams.get("next"));
  redirect(actor.mustChangePassword ? "/account/password" : (next ?? "/"));
}
