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

export type LastAdmin = Readonly<{ kind: "LastAdmin" }>;
export type CannotDisableSelf = Readonly<{ kind: "CannotDisableSelf" }>;
