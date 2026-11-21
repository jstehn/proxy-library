import { err, ok, type Result } from "@/shared/kernel";
import type { Forbidden, OAuthClientInvalid, OAuthClientNotFound } from "../domain/errors";
import type { Actor } from "../domain/player";
import { requireAdmin } from "../domain/rules";
import type { makeCreateOAuthClient, RegisteredClient } from "./oauth";
import type { AccountsDependencies } from "./ports";

// Clients an admin makes by hand (design doc 69, section 5): for a connector that asks for an
// "OAuth client ID and client secret" instead of registering itself.

export type CreateManualClientInput = Readonly<{
  name: string;
  redirectUris: readonly string[];
  /** A confidential client gets a secret, shown once; a public one relies on PKCE alone. */
  confidential: boolean;
}>;

export type CreateManualClientError = Forbidden | OAuthClientInvalid;
export type DeleteOAuthClientError = Forbidden | OAuthClientNotFound;

export function makeCreateManualOAuthClient(
  createOAuthClient: ReturnType<typeof makeCreateOAuthClient>,
) {
  async function createManualOAuthClient(
    admin: Actor,
    input: CreateManualClientInput,
  ): Promise<Result<RegisteredClient, CreateManualClientError>> {
    const allowed = requireAdmin(admin);
    if (!allowed.ok) return allowed;
    return createOAuthClient({
      clientName: input.name,
      redirectUris: input.redirectUris,
      authMethod: input.confidential ? "client_secret_basic" : "none",
      createdBy: admin.userId,
    });
  }

  return createManualOAuthClient;
}

/** Removes a client and revokes every token it made, for every player. */
export function makeDeleteOAuthClient(dependencies: AccountsDependencies) {
  const { unitOfWork, clock } = dependencies;

  async function deleteOAuthClient(
    admin: Actor,
    input: { clientId: string },
  ): Promise<Result<void, DeleteOAuthClientError>> {
    const allowed = requireAdmin(admin);
    if (!allowed.ok) return allowed;
    return unitOfWork.run<void, DeleteOAuthClientError>(async ({ accessTokens, oauth }) => {
      await accessTokens.revokeForClient(input.clientId, clock.now());
      const deleted = await oauth.deleteClient(input.clientId);
      return deleted ? ok() : err({ kind: "OAuthClientNotFound" });
    });
  }

  return deleteOAuthClient;
}
