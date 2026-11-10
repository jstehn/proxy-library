import type { AuthorizationParameters } from "@/modules/accounts";

// The OAuth request's fields (design doc 30), read the same way from the page's query string
// and from the approval form's hidden inputs.

export const PARAMETER_NAMES = {
  clientId: "client_id",
  redirectUri: "redirect_uri",
  responseType: "response_type",
  codeChallenge: "code_challenge",
  codeChallengeMethod: "code_challenge_method",
  scope: "scope",
  state: "state",
} as const satisfies Record<keyof AuthorizationParameters, string>;

/** The parameters from a lookup by name; a missing or empty one is null. */
export function readParameters(
  get: (name: string) => string | string[] | File | null | undefined,
): AuthorizationParameters {
  const read = (name: string): string | null => {
    const raw = get(name);
    const value = Array.isArray(raw) ? raw[0] : raw;
    return typeof value === "string" && value !== "" ? value : null;
  };
  return {
    clientId: read(PARAMETER_NAMES.clientId),
    redirectUri: read(PARAMETER_NAMES.redirectUri),
    responseType: read(PARAMETER_NAMES.responseType),
    codeChallenge: read(PARAMETER_NAMES.codeChallenge),
    codeChallengeMethod: read(PARAMETER_NAMES.codeChallengeMethod),
    scope: read(PARAMETER_NAMES.scope),
    state: read(PARAMETER_NAMES.state),
  };
}

/** The parameters as a query string, to come back to the page. */
export function queryOf(parameters: AuthorizationParameters): string {
  const query = new URLSearchParams();
  for (const [key, name] of Object.entries(PARAMETER_NAMES)) {
    const value = parameters[key as keyof AuthorizationParameters];
    if (value !== null) query.set(name, value);
  }
  return query.toString();
}
