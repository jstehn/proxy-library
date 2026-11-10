"use server";
// Controller for the approval form (design doc 30): approve or deny, then send the browser back
// to the app that asked.
import { redirect } from "next/navigation";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { assertNever } from "@/shared/kernel";
import { queryOf, readParameters } from "./parameters";

export async function decideAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const parameters = readParameters((name) => formData.get(name));
  const { accounts } = getContainer();
  const back = `/oauth/authorize?${queryOf(parameters)}`;

  const result =
    formData.get("decision") === "approve"
      ? await accounts.approveAuthorization(
          actor,
          parameters,
          formData.getAll("scope").filter((scope) => typeof scope === "string"),
        )
      : await accounts.denyAuthorization(parameters);
  if (result.ok) redirect(result.value.redirectTo);

  const { error } = result;
  switch (error.kind) {
    case "TooManyTokens":
      redirect(`${back}&problem=too-many-tokens`);
    // The page itself shows or redirects these, as it did before the form was sent.
    case "UnknownClient":
    case "RedirectUriNotRegistered":
    case "AuthorizationRefused":
      redirect(back);
    default:
      return assertNever(error);
  }
}
