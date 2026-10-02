// Composition root for the Next.js app. `server-only` makes the build fail if a
// Client Component ever imports this (and, through it, the database).
import "server-only";
import { pgDraftSubscriptions, type DraftSubscriptions } from "@/modules/drafts/infrastructure";
import { loadConfig } from "@/shared/config";
import { buildCore, type Core } from "./core";

declare global {
  // Survives Next.js dev hot reloads, so each edit doesn't open a new connection pool.
  var __tcgContainer: Core | undefined;
  // One LISTEN connection for live draft updates (ADR 0018), kept across hot reloads too.
  var __tcgDraftSubscriptions: DraftSubscriptions | undefined;
}

/** The app's services, built lazily on first use (so `next build` needs no database). */
export function getContainer(): Core {
  globalThis.__tcgContainer ??= buildCore(loadConfig());
  return globalThis.__tcgContainer;
}

/**
 * Live draft updates (ADR 0018). Only the app needs them: it streams them to browsers. The worker
 * only sends notifications, from inside its transactions.
 */
export function getDraftSubscriptions(): DraftSubscriptions {
  globalThis.__tcgDraftSubscriptions ??= pgDraftSubscriptions(loadConfig().databaseUrl);
  return globalThis.__tcgDraftSubscriptions;
}
