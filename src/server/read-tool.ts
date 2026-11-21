import "server-only";
import { allows, type Actor, type Scope } from "@/modules/accounts";
import type { Capabilities } from "./composition/capabilities";
import { getContainer } from "./composition/container";
import type { Reads } from "./composition/reads";

/** Who is calling a tool endpoint, what their token may do, and what the app can do for them. */
export type ToolRequest = Readonly<{
  actor: Actor;
  scopes: readonly Scope[];
  /** Whether the token's scopes cover `scope`. */
  allows(scope: Scope): boolean;
  capabilities: Capabilities;
  reads: Reads;
}>;

/**
 * `readPage()` for the tool endpoints (`/api/mcp`, `/api/tools/<name>`): they sign in with
 * `Authorization: Bearer pl_…`, not a cookie. Null for anything wrong with the token (rule 1 of
 * design doc 28: every failure looks alike).
 */
export async function readTool(request: Request): Promise<ToolRequest | null> {
  const { capabilities, reads } = getContainer();
  const found = await capabilities.accounts.actorFromToken(request.headers.get("authorization"));
  if (found === null) return null;
  return {
    actor: found.actor,
    scopes: found.scopes,
    allows: (scope) => allows(found.scopes, scope),
    capabilities,
    reads,
  };
}
