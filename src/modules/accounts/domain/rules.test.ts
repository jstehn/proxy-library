import { describe, expect, it } from "vitest";
import { UserId } from "@/shared/kernel";
import type { DisplayName, Username } from "./credentials";
import { newPlayer, toActor, type Player } from "./player";
import { checkAdminChange, checkDisableChange, requireAdmin } from "./rules";

function player(overrides: Partial<Player> = {}): Player {
  return {
    ...newPlayer({
      userId: UserId.of("player-1"),
      username: "jack" as Username,
      displayName: "Jack" as DisplayName,
      isAdmin: false,
      joinedAt: new Date("2026-01-01T00:00:00Z"),
    }),
    ...overrides,
  };
}

const admin = player({ userId: UserId.of("admin-1"), isAdmin: true });
const otherAdmin = player({ userId: UserId.of("admin-2"), isAdmin: true });
const regular = player({ userId: UserId.of("player-2") });

describe("requireAdmin (rule 9)", () => {
  it("allows admins and forbids everyone else", () => {
    expect(requireAdmin(toActor(admin)).ok).toBe(true);
    expect(requireAdmin(toActor(regular))).toEqual({ ok: false, error: { kind: "Forbidden" } });
  });
});

describe("checkAdminChange (rule 6)", () => {
  it("refuses to demote the last active admin", () => {
    expect(checkAdminChange({ target: admin, makeAdmin: false, activeAdminCount: 1 })).toEqual({
      ok: false,
      error: { kind: "LastAdmin" },
    });
  });

  it("allows demoting an admin when another active admin remains", () => {
    expect(checkAdminChange({ target: admin, makeAdmin: false, activeAdminCount: 2 }).ok).toBe(
      true,
    );
  });

  it("allows promoting anyone, and demoting a disabled admin", () => {
    expect(checkAdminChange({ target: regular, makeAdmin: true, activeAdminCount: 1 }).ok).toBe(
      true,
    );
    const disabledAdmin = player({ isAdmin: true, disabledAt: new Date() });
    expect(
      checkAdminChange({ target: disabledAdmin, makeAdmin: false, activeAdminCount: 1 }).ok,
    ).toBe(true);
  });
});

describe("checkDisableChange (rules 6 and 7)", () => {
  it("refuses to disable yourself", () => {
    expect(
      checkDisableChange({
        actor: toActor(admin),
        target: admin,
        disable: true,
        activeAdminCount: 2,
      }),
    ).toEqual({ ok: false, error: { kind: "CannotDisableSelf" } });
  });

  it("refuses to disable the last active admin", () => {
    // `admin` acts on `otherAdmin`, but pretend otherAdmin is the only *active* one left.
    expect(
      checkDisableChange({
        actor: toActor(admin),
        target: otherAdmin,
        disable: true,
        activeAdminCount: 1,
      }),
    ).toEqual({ ok: false, error: { kind: "LastAdmin" } });
  });

  it("allows disabling a regular player, and re-enabling anyone", () => {
    const actor = toActor(admin);
    expect(
      checkDisableChange({ actor, target: regular, disable: true, activeAdminCount: 1 }).ok,
    ).toBe(true);
    expect(
      checkDisableChange({ actor, target: admin, disable: false, activeAdminCount: 1 }).ok,
    ).toBe(true);
  });
});
