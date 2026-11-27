import "server-only";
import { makeAction } from "./action";
import { getContainer } from "./composition/container";
import { resolveActionLabel, wrapObservedAction } from "./observability";
import { requireActor } from "./session";

const baseAction = makeAction({
  requireActor: () => requireActor(),
  capabilities: () => getContainer().capabilities,
  reads: () => getContainer().reads,
});

/** `action(schema, handler)`: the real helper. Server actions use this one (ADR 0026). */
export const action: typeof baseAction = (schema, handler) =>
  wrapObservedAction(
    resolveActionLabel("action", handler.name, schema),
    baseAction(schema, handler),
  );
