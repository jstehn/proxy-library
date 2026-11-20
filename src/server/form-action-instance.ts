import "server-only";
import { redirect } from "next/navigation";
import { getContainer } from "./container";
import { makeFormAction } from "./form-action";
import { requireActor, requireAdminActor } from "./session";

/** `formAction(schema, handler, options)`: the real helper. Server actions for forms use this one (ADR 0026). */
export const formAction = makeFormAction({
  requireActor: () => requireActor(),
  requireAdminActor: () => requireAdminActor(),
  capabilities: () => getContainer().capabilities,
  reads: () => getContainer().reads,
  redirect,
});
