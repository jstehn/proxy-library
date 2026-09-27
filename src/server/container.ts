// Composition root for the Next.js app. `server-only` makes the build fail if a
// Client Component ever imports this (and, through it, the database).
import "server-only";
import { loadConfig } from "@/shared/config";
import { buildCore, type Core } from "./core";

declare global {
  // Survives Next.js dev hot reloads, so each edit doesn't open a new connection pool.
  var __tcgContainer: Core | undefined;
}

/** The app's services, built lazily on first use (so `next build` needs no database). */
export function getContainer(): Core {
  globalThis.__tcgContainer ??= buildCore(loadConfig());
  return globalThis.__tcgContainer;
}
