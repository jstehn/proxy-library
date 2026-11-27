import "server-only";
import { redirect } from "next/navigation";
import { getContainer } from "./composition/container";
import { makeFormAction, makeFormRedirect, makeFormVoid } from "./form-action";
import { resolveActionLabel, wrapObservedAction } from "./observability";
import { requireActor, requireAdminActor } from "./session";

/** `formAction(schema, handler, options)`: the real helper. Server actions for forms use this one (ADR 0026). */
const sources = {
  requireActor: (options?: { allowPasswordChangePending?: boolean }) => requireActor(options),
  requireAdminActor: () => requireAdminActor(),
  capabilities: () => getContainer().capabilities,
  reads: () => getContainer().reads,
  redirect,
};

const baseFormAction = makeFormAction(sources);
const baseFormRedirect = makeFormRedirect(sources);
const baseFormVoid = makeFormVoid(sources);

type RunnerFactory = (
  schemaArg: unknown,
  handlerArg: unknown,
  optionsArg?: unknown,
) => (...runnerArgs: never[]) => Promise<unknown>;

function observeFormFactory<
  Factory extends (...factoryArgs: never[]) => (...runnerArgs: never[]) => Promise<unknown>,
>(prefix: string, factory: Factory): Factory {
  return ((
    schema: unknown,
    handler: (...handlerArgs: never[]) => Promise<unknown>,
    options?: unknown,
  ) =>
    wrapObservedAction(
      resolveActionLabel(prefix, handler.name, schema),
      (factory as unknown as RunnerFactory)(schema, handler, options),
    )) as unknown as Factory;
}

export const formAction = observeFormFactory("formAction", baseFormAction);

/** For a plain `<form action>` that always redirects (to the page with `?error=` or `?message=`). */
export const formRedirect = observeFormFactory("formRedirect", baseFormRedirect);

/** For a plain `<form action>` that shows nothing after it is sent. */
export const formVoid = observeFormFactory("formVoid", baseFormVoid);
