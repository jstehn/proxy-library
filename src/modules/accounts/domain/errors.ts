// Every expected failure in the accounts module. Each is a small object with a `kind`, so
// callers can `switch (error.kind)` and the compiler checks they handled every case.

export type Forbidden = Readonly<{ kind: "Forbidden" }>;
export type PlayerNotFound = Readonly<{ kind: "PlayerNotFound" }>;

export type UsernameInvalid = Readonly<{ kind: "UsernameInvalid"; reason: string }>;
export type UsernameTaken = Readonly<{ kind: "UsernameTaken" }>;
export type DisplayNameInvalid = Readonly<{ kind: "DisplayNameInvalid"; reason: string }>;
export type PasswordInvalid = Readonly<{ kind: "PasswordInvalid"; reason: string }>;
export type InvalidCredentials = Readonly<{ kind: "InvalidCredentials" }>;
export type AccountDisabled = Readonly<{ kind: "AccountDisabled" }>;

export type InviteRequired = Readonly<{ kind: "InviteRequired" }>;
export type InviteNotFound = Readonly<{ kind: "InviteNotFound" }>;
export type InviteNotOpen = Readonly<{
  kind: "InviteNotOpen";
  status: "used" | "expired" | "revoked";
}>;
export type InviteDurationInvalid = Readonly<{ kind: "InviteDurationInvalid" }>;

export type TokenNameInvalid = Readonly<{ kind: "TokenNameInvalid"; maximum: number }>;
export type TooManyTokens = Readonly<{ kind: "TooManyTokens"; maximum: number }>;
export type TokenNotFound = Readonly<{ kind: "TokenNotFound" }>;

export type LastAdmin = Readonly<{ kind: "LastAdmin" }>;
export type CannotDisableSelf = Readonly<{ kind: "CannotDisableSelf" }>;

// OAuth for web connectors (design doc 30).
export type OAuthClientInvalid = Readonly<{
  kind: "OAuthClientInvalid";
  /** RFC 7591's error name: which part of the registration was refused. */
  error: "invalid_redirect_uri" | "invalid_client_metadata";
  reason: string;
}>;
export type OAuthClientNotFound = Readonly<{ kind: "OAuthClientNotFound" }>;
/** Shown on the approval page, never redirected to (rule 2). */
export type UnknownClient = Readonly<{ kind: "UnknownClient" }>;
/** Carries what was sent and what is registered, so the page can name both (design doc 69). */
export type RedirectUriNotRegistered = Readonly<{
  kind: "RedirectUriNotRegistered";
  sentUri: string | null;
  registeredUris: readonly string[];
}>;
/** Sent back to the client's redirect URI as `error=…` (RFC 6749, section 4.1.2.1). */
export type AuthorizationRefused = Readonly<{
  kind: "AuthorizationRefused";
  error: "invalid_request" | "unsupported_response_type";
  description: string;
  redirectUri: string;
  state: string | null;
}>;
/** The token endpoint's errors (RFC 6749, section 5.2). */
export type TokenRequestRefused = Readonly<{
  kind: "TokenRequestRefused";
  error: "invalid_request" | "invalid_grant" | "invalid_client" | "unsupported_grant_type";
  description: string;
}>;
