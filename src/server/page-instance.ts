import "server-only";
import { getContainer } from "./composition/container";
import { makeReadPage } from "./page";
import { getCurrentActor, requireActor, requireAdminActor } from "./session";

/** `readPage()`: the real helper. Pages and routes use this one (ADR 0026). */
export const readPage = makeReadPage({
  requireActor: (options) => requireActor(options),
  requireAdminActor: () => requireAdminActor(),
  currentActor: () => getCurrentActor(),
  capabilities: () => getContainer().capabilities,
  reads: () => getContainer().reads,
  publicReads: () => getContainer().publicReads,
});

/**
 * The capabilities alone, for routes that read nothing for a player: card images, product
 * artwork and the OpenAPI document (design doc 67, section 5). Routes that sign in with a
 * bearer token use `readTool()`.
 */
export function readCapabilities() {
  return getContainer().capabilities;
}
