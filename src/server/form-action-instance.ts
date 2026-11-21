import "server-only";
import { redirect } from "next/navigation";
import { getContainer } from "./container";
import { makeFormAction, makeFormRedirect, makeFormVoid } from "./form-action";
import { requireActor, requireAdminActor } from "./session";

/** `formAction(schema, handler, options)`: the real helper. Server actions for forms use this one (ADR 0026). */
const sources = {
  requireActor: (options?: { allowPasswordChangePending?: boolean }) => requireActor(options),
  requireAdminActor: () => requireAdminActor(),
  capabilities: () => getContainer().capabilities,
  reads: () => getContainer().reads,
  redirect,
};

export const formAction = makeFormAction(sources);

/** For a plain `<form action>` that always redirects (to the page with `?error=` or `?message=`). */
export const formRedirect = makeFormRedirect(sources);

/** For a plain `<form action>` that shows nothing after it is sent. */
export const formVoid = makeFormVoid(sources);
