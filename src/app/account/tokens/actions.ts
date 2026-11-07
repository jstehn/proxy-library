"use server";
import { revalidatePath } from "next/cache";
import { AccessTokenId, SCOPES } from "@/modules/accounts";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";

// Making and revoking access tokens for LLM clients (design doc 28, section 9).

export type CreateTokenState = Readonly<
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "created"; name: string; secret: string }
>;

export async function createTokenAction(
  _previous: CreateTokenState,
  formData: FormData,
): Promise<CreateTokenState> {
  const actor = await requireActor();
  const scopes = formData
    .getAll("scope")
    .map(String)
    .filter((scope) => (SCOPES as readonly string[]).includes(scope));
  const name = String(formData.get("name") ?? "");
  const result = await getContainer().accounts.createAccessToken(actor, { name, scopes });
  if (!result.ok) {
    return {
      kind: "error",
      message:
        result.error.kind === "TokenNameInvalid"
          ? `Give the token a name of up to ${result.error.maximum} characters.`
          : `You have ${result.error.maximum} tokens, the most allowed. Revoke one first.`,
    };
  }
  revalidatePath("/account/tokens");
  return { kind: "created", name: result.value.token.name, secret: result.value.secret };
}

export async function revokeTokenAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const raw = Number(formData.get("tokenId"));
  if (Number.isSafeInteger(raw) && raw > 0) {
    await getContainer().accounts.revokeAccessToken(actor, AccessTokenId.of(raw));
  }
  revalidatePath("/account/tokens");
}
