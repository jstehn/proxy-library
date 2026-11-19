import "server-only";
import { getContainer } from "./container";
import { makeReadPage } from "./page";
import { getCurrentActor, requireActor } from "./session";

/** `readPage()`: the real helper. Pages and routes use this one (ADR 0026). */
export const readPage = makeReadPage({
  requireActor: () => requireActor(),
  currentActor: () => getCurrentActor(),
  capabilities: () => getContainer().capabilities,
});
