import type { Actor, AdminActor } from "@/modules/accounts";
import type { Capabilities } from "./composition/capabilities";
import type { PublicReads, Reads } from "./composition/reads";

// `action()`'s twin for pages and routes (ADR 0026): find out who is looking, and hand over the
// capabilities and the reads. A page reads through `reads`, never through `getContainer().db`.

export type PageContext = Readonly<{ actor: Actor; capabilities: Capabilities; reads: Reads }>;
export type AdminPageContext = Readonly<{
  actor: AdminActor;
  capabilities: Capabilities;
  reads: Reads;
}>;
/**
 * A page visitors may open too. Narrow on `actor`: a signed-in player gets every read, a visitor
 * only `PublicReads` (the reads whose credential is a token).
 */
export type VisitorPageContext =
  PageContext | Readonly<{ actor: null; capabilities: Capabilities; reads: PublicReads }>;

export type PageSources = Readonly<{
  /** The signed-in player (sends visitors who aren't signed in to the sign-in page). */
  requireActor(options?: { allowPasswordChangePending?: boolean }): Promise<Actor>;
  /** The signed-in admin; anyone else sees "not found". */
  requireAdminActor(): Promise<AdminActor>;
  /** The signed-in player, or null for a visitor. */
  currentActor(): Promise<Actor | null>;
  capabilities(): Capabilities;
  reads(): Reads;
  publicReads(): PublicReads;
  /**
   * Starts timing this page's render (see `page-metrics.ts`). Called before anything is awaited;
   * returns an optional callback to schedule finishing once actor lookup (and any `cookies()` /
   * `headers()` calls it makes) has completed.
   */
  startMetrics?(): (() => Promise<void> | void) | void;
}>;

/** Builds `readPage` from where the actor, the capabilities and the reads come from (fakes in tests). */
export function makeReadPage(sources: PageSources) {
  /** A signed-in player's page. */
  function readPage(): Promise<PageContext>;
  /** An admin's page: `actor` is an `AdminActor`, so admin reads compile only here. */
  function readPage(options: { admin: true }): Promise<AdminPageContext>;
  /** The page of a player who must change a reset password first can still open. */
  function readPage(options: { allowPasswordChangePending: true }): Promise<PageContext>;
  /** A page visitors may open too: `actor` is null for them. */
  function readPage(options: { allowVisitors: true }): Promise<VisitorPageContext>;
  async function readPage(
    options: { admin?: true; allowPasswordChangePending?: true; allowVisitors?: true } = {},
  ): Promise<PageContext | AdminPageContext | VisitorPageContext> {
    // Before the first await, so the measurement covers actor lookup and everything after it.
    const scheduleFinish = sources.startMetrics?.();
    const capabilities = sources.capabilities();
    if (options.allowVisitors) {
      const actor = await sources.currentActor();
      await scheduleFinish?.();
      return actor === null
        ? { actor: null, capabilities, reads: sources.publicReads() }
        : { actor, capabilities, reads: sources.reads() };
    }
    if (options.admin) {
      const actor = await sources.requireAdminActor();
      await scheduleFinish?.();
      return { actor, capabilities, reads: sources.reads() };
    }
    const actor = await sources.requireActor({
      allowPasswordChangePending: options.allowPasswordChangePending,
    });
    await scheduleFinish?.();
    return { actor, capabilities, reads: sources.reads() };
  }
  return readPage;
}
