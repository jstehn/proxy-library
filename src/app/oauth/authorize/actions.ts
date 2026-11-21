"use server";
// Controller for the approval form (design doc 30): approve or deny, then send the browser back
// to the app that asked.
import { z } from "zod";
import { formRedirect } from "@/server/form-action-instance";
import { assertNever } from "@/shared/kernel";
import { PARAMETER_NAMES, queryOf, readParameters } from "./parameters";

// The form carries the OAuth request in hidden inputs, the chosen scopes (checkboxes named
// "scope", as the request's own "scope" is a single string) and which button was pressed.
const DecideForm = z.object({
  ...Object.fromEntries(
    Object.values(PARAMETER_NAMES).map((name) => [name, z.string().optional()]),
  ),
  scope: z.array(z.string()).default([]),
  decision: z.string().default(""),
});

export const decideAction = formRedirect(DecideForm, async ({ actor, capabilities }, input) => {
  const fields: Record<string, string | string[] | undefined> = input;
  const parameters = readParameters((name) => fields[name]);
  const { accounts } = capabilities;
  const back = `/oauth/authorize?${queryOf(parameters)}`;

  const result =
    input.decision === "approve"
      ? await accounts.approveAuthorization(actor, parameters, input.scope)
      : await accounts.denyAuthorization(parameters);
  if (result.ok) return result.value.redirectTo;

  const { error } = result;
  switch (error.kind) {
    case "TooManyTokens":
      return `${back}&problem=too-many-tokens`;
    // The page itself shows or redirects these, as it did before the form was sent.
    case "UnknownClient":
    case "RedirectUriNotRegistered":
    case "AuthorizationRefused":
      return back;
    default:
      return assertNever(error);
  }
});
