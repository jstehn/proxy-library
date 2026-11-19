import "server-only";
import { getContainer } from "./container";
import { makeReadPage } from "./page";
import { getCurrentActor, requireActor, requireAdminActor } from "./session";

/** `readPage()`: the real helper. Pages and routes use this one (ADR 0026). */
export const readPage = makeReadPage({
  requireActor: (options) => requireActor(options),
  requireAdminActor: () => requireAdminActor(),
  currentActor: () => getCurrentActor(),
  capabilities: () => getContainer().capabilities,
});

/** The capabilities alone, for routes that sign in some other way (a bearer token) or not at all. */
export function readCapabilities() {
  return getContainer().capabilities;
}
