import type { Actor } from "@/modules/accounts";
import type { Capabilities } from "./capabilities";

// `action()`'s twin for pages and routes (ADR 0026): find out who is looking, and hand over the
// capabilities. A page reads through these, never through `getContainer().db`.

export type PageContext = Readonly<{ actor: Actor; capabilities: Capabilities }>;
export type VisitorPageContext = Readonly<{ actor: Actor | null; capabilities: Capabilities }>;

export type PageSources = Readonly<{
  /** The signed-in player (sends visitors who aren't signed in to the sign-in page). */
  requireActor(options?: { allowPasswordChangePending?: boolean }): Promise<Actor>;
  /** The signed-in admin; anyone else sees "not found". */
  requireAdminActor(): Promise<Actor>;
  /** The signed-in player, or null for a visitor. */
  currentActor(): Promise<Actor | null>;
  capabilities(): Capabilities;
}>;

/** Builds `readPage` from where the actor and the capabilities come from (fakes in tests). */
export function makeReadPage(sources: PageSources) {
  /** A signed-in player's page. */
  function readPage(): Promise<PageContext>;
  /** An admin's page. */
  function readPage(options: { admin: true }): Promise<PageContext>;
  /** The page of a player who must change a reset password first can still open. */
  function readPage(options: { allowPasswordChangePending: true }): Promise<PageContext>;
  /** A page visitors may open too: `actor` is null for them. */
  function readPage(options: { allowVisitors: true }): Promise<VisitorPageContext>;
  async function readPage(
    options: { admin?: true; allowPasswordChangePending?: true; allowVisitors?: true } = {},
  ) {
    const actor = options.allowVisitors
      ? await sources.currentActor()
      : options.admin
        ? await sources.requireAdminActor()
        : await sources.requireActor({
            allowPasswordChangePending: options.allowPasswordChangePending,
          });
    return { actor, capabilities: sources.capabilities() };
  }
  return readPage;
}
