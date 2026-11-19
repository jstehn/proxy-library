import { describe, expect, it } from "vitest";
import { describePlayerActionError, describeRegisterPlayerError } from "./describe-error";

describe("account error sentences", () => {
  it("says what happened to a cancelled or used invite", () => {
    expect(describeRegisterPlayerError({ kind: "InviteNotOpen", status: "revoked" })).toBe(
      "That invite code has been cancelled. Ask an admin for a new one.",
    );
    expect(describeRegisterPlayerError({ kind: "InviteNotOpen", status: "used" })).toBe(
      "That invite code has been used. Ask an admin for a new one.",
    );
  });

  it("tells an admin why the last admin can't be changed", () => {
    expect(describePlayerActionError({ kind: "LastAdmin" })).toContain("at least one active admin");
  });
});
