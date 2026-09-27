import type { Cents } from "@/shared/kernel";

// Every expected failure in the wallet module, each with a `kind` for exhaustive switches.

export type Forbidden = Readonly<{ kind: "Forbidden" }>;
export type PlayerNotFound = Readonly<{ kind: "PlayerNotFound" }>;
export type AmountInvalid = Readonly<{ kind: "AmountInvalid"; reason: string }>;
export type NoteInvalid = Readonly<{ kind: "NoteInvalid"; reason: string }>;
export type InsufficientFunds = Readonly<{
  kind: "InsufficientFunds";
  balance: Cents;
  required: Cents;
}>;
export type SelfFundingNotAllowed = Readonly<{ kind: "SelfFundingNotAllowed" }>;
export type SelfFundLimitExceeded = Readonly<{ kind: "SelfFundLimitExceeded"; limit: Cents }>;
export type SettingsInvalid = Readonly<{ kind: "SettingsInvalid"; reason: string }>;
