import "server-only";
import { makeAction } from "./action";
import { getContainer } from "./container";
import { requireActor } from "./session";

/** `action(schema, handler)`: the real helper. Server actions use this one (ADR 0026). */
export const action = makeAction({
  requireActor: () => requireActor(),
  capabilities: () => getContainer().capabilities,
});
