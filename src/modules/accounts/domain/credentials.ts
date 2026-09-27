import { err, ok, type Brand, type Result } from "@/shared/kernel";
import type { DisplayNameInvalid, PasswordInvalid, UsernameInvalid } from "./errors";

// Branded strings for what a player types in. Each has a `parse` function that checks the
// rules once, so any code holding a `Username` knows it is already valid.

/** Lowercase, 3–20 characters of a–z, 0–9, "_" or "-". Unique per player. */
export type Username = Brand<string, "Username">;

/** What other players see. 1–40 characters after trimming spaces. */
export type DisplayName = Brand<string, "DisplayName">;

/** A password as typed. Never stored by us: Better Auth stores only a hash of it. */
export type Password = Brand<string, "Password">;

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;
export const DISPLAY_NAME_MAX_LENGTH = 40;
export const PASSWORD_MIN_LENGTH = 6;
export const PASSWORD_MAX_LENGTH = 128;

const USERNAME_PATTERN = /^[a-z0-9_-]+$/;

export const Username = {
  parse(raw: string): Result<Username, UsernameInvalid> {
    const username = raw.trim().toLowerCase();
    if (username.length < USERNAME_MIN_LENGTH || username.length > USERNAME_MAX_LENGTH) {
      return err({
        kind: "UsernameInvalid",
        reason: `must be ${USERNAME_MIN_LENGTH}–${USERNAME_MAX_LENGTH} characters`,
      });
    }
    if (!USERNAME_PATTERN.test(username)) {
      return err({
        kind: "UsernameInvalid",
        reason: "may only contain letters, numbers, _ and -",
      });
    }
    return ok(username as Username);
  },
};

export const DisplayName = {
  parse(raw: string): Result<DisplayName, DisplayNameInvalid> {
    const displayName = raw.trim();
    if (displayName.length === 0) {
      return err({ kind: "DisplayNameInvalid", reason: "is required" });
    }
    if (displayName.length > DISPLAY_NAME_MAX_LENGTH) {
      return err({
        kind: "DisplayNameInvalid",
        reason: `must be at most ${DISPLAY_NAME_MAX_LENGTH} characters`,
      });
    }
    return ok(displayName as DisplayName);
  },
};

export const Password = {
  /** Only length is checked. Spaces are allowed and kept exactly as typed. */
  parse(raw: string): Result<Password, PasswordInvalid> {
    if (raw.length < PASSWORD_MIN_LENGTH) {
      return err({
        kind: "PasswordInvalid",
        reason: `must be at least ${PASSWORD_MIN_LENGTH} characters`,
      });
    }
    if (raw.length > PASSWORD_MAX_LENGTH) {
      return err({
        kind: "PasswordInvalid",
        reason: `must be at most ${PASSWORD_MAX_LENGTH} characters`,
      });
    }
    return ok(raw as Password);
  },
};
