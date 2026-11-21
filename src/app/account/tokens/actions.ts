"use server";
import { z } from "zod";
import { AccessTokenId, SCOPES } from "@/modules/accounts";
import { parseForm } from "@/server/form-action";
import { formVoid } from "@/server/form-action-instance";
import { readPage } from "@/server/page-instance";
import { revalidateTokens } from "../paths";

// Making and revoking access tokens for LLM clients (design doc 28, section 9).

export type CreateTokenState = Readonly<
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "created"; name: string; secret: string }
>;

const CreateTokenForm = z.object({
  name: z.string().default(""),
  scope: z.array(z.string()).default([]),
});

export async function createTokenAction(
  _previous: CreateTokenState,
  formData: FormData,
): Promise<CreateTokenState> {
  const { actor, capabilities } = await readPage();
  // The schema can't fail: a missing field is an empty name or no scopes.
  const form = parseForm(CreateTokenForm, formData);
  const { name, scope } = form.success ? form.data : { name: "", scope: [] };
  const scopes = scope.filter((each) => (SCOPES as readonly string[]).includes(each));
  const result = await capabilities.accounts.createAccessToken(actor, { name, scopes });
  if (!result.ok) {
    return {
      kind: "error",
      message:
        result.error.kind === "TokenNameInvalid"
          ? `Give the token a name of up to ${result.error.maximum} characters.`
          : `You have ${result.error.maximum} tokens, the most allowed. Revoke one first.`,
    };
  }
  revalidateTokens();
  return { kind: "created", name: result.value.token.name, secret: result.value.secret };
}

export const revokeTokenAction = formVoid(
  z.object({ tokenId: z.coerce.number().int().positive() }),
  async ({ actor, capabilities }, { tokenId }) => {
    await capabilities.accounts.revokeAccessToken(actor, AccessTokenId.of(tokenId));
    revalidateTokens();
  },
);
