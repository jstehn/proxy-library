import { beforeEach, describe, expect, it } from "vitest";
import { err, ok, UserId } from "@/shared/kernel";
import { manualClock } from "@/shared/kernel/testing";
import { toActor, type Actor, type Player } from "../domain/player";
import {
  inMemoryAccountsServices,
  inMemoryAccountsUnitOfWork,
  inMemoryIdentityProvider,
  sequentialSecretGenerator,
} from "../testing/fakes";
import { makeAccounts } from "./make-accounts";
import type { AccountsServices } from "./ports";

// Use-case tests: the real accounts code, running against in-memory fakes.

const DAY = 24 * 60 * 60 * 1000;

let services: AccountsServices;
let identity: ReturnType<typeof inMemoryIdentityProvider>;
let clock: ReturnType<typeof manualClock>;
let accounts: ReturnType<typeof makeAccounts>;

beforeEach(() => {
  services = inMemoryAccountsServices();
  identity = inMemoryIdentityProvider();
  clock = manualClock("2026-01-01T12:00:00Z");
  accounts = makeAccounts({
    unitOfWork: inMemoryAccountsUnitOfWork(services),
    identity,
    secrets: sequentialSecretGenerator(),
    clock,
  });
});

/** Registers a player and fails the test if that doesn't work. */
async function register(username: string, inviteCode = ""): Promise<Player> {
  const result = await accounts.registerPlayer({
    username,
    displayName: username.toUpperCase(),
    password: "secret-password",
    inviteCode,
  });
  if (!result.ok) throw new Error(`could not register ${username}: ${result.error.kind}`);
  return result.value;
}

/** Creates an invite as `admin` and returns its code. */
async function inviteCodeFrom(admin: Actor): Promise<string> {
  const invite = await accounts.createInvite(admin, { validForDays: 7 });
  if (!invite.ok) throw new Error(`could not create invite: ${invite.error.kind}`);
  return invite.value.code;
}

async function adminAndPlayer(): Promise<{ admin: Actor; player: Player }> {
  const admin = toActor(await register("admin"));
  const player = await register("jack", await inviteCodeFrom(admin));
  return { admin, player };
}

describe("registerPlayer", () => {
  it("makes the very first player an admin, without an invite (rule 4)", async () => {
    const first = await register("jack");
    expect(first.isAdmin).toBe(true);
    expect(first.username).toBe("jack");
  });

  it("requires an invite for everyone after the first player (rule 4)", async () => {
    await register("admin");
    const result = await accounts.registerPlayer({
      username: "jack",
      displayName: "Jack",
      password: "secret-password",
      inviteCode: "",
    });
    expect(result).toEqual(err({ kind: "InviteRequired" }));
  });

  it("registers a regular (non-admin) player with an open invite", async () => {
    const { player } = await adminAndPlayer();
    expect(player.isAdmin).toBe(false);
  });

  it("rejects unknown, used, revoked and expired invites (rule 5)", async () => {
    const admin = toActor(await register("admin"));
    let attempts = 0;
    const attempt = (inviteCode: string) =>
      accounts.registerPlayer({
        username: `newcomer${++attempts}`,
        displayName: "Newcomer",
        password: "secret-password",
        inviteCode,
      });

    expect(await attempt("ZZZZ-ZZZZ-ZZZZ")).toEqual(err({ kind: "InviteNotFound" }));
    expect(await attempt("not a code")).toEqual(err({ kind: "InviteNotFound" }));

    const used = await inviteCodeFrom(admin);
    await register("jack", used);
    expect(await attempt(used)).toEqual(err({ kind: "InviteNotOpen", status: "used" }));

    const revoked = await inviteCodeFrom(admin);
    await accounts.revokeInvite(admin, { code: revoked });
    expect(await attempt(revoked)).toEqual(err({ kind: "InviteNotOpen", status: "revoked" }));

    const expired = await inviteCodeFrom(admin);
    clock.advanceBy(8 * DAY);
    expect(await attempt(expired)).toEqual(err({ kind: "InviteNotOpen", status: "expired" }));
  });

  it("accepts an invite typed in lowercase with spaces", async () => {
    const admin = toActor(await register("admin"));
    const code = await inviteCodeFrom(admin);
    const player = await register("jack", `  ${code.toLowerCase()} `);
    expect(player.username).toBe("jack");
  });

  it("reports a taken username, and leaves the invite unused", async () => {
    const admin = toActor(await register("admin"));
    const code = await inviteCodeFrom(admin);
    const result = await accounts.registerPlayer({
      username: "ADMIN",
      displayName: "Imposter",
      password: "secret-password",
      inviteCode: code,
    });
    expect(result).toEqual(err({ kind: "UsernameTaken" }));
    expect((await register("jack", code)).username).toBe("jack");
  });

  it("checks username, display name and password before anything else", async () => {
    const result = await accounts.registerPlayer({
      username: "x",
      displayName: "X",
      password: "pw",
      inviteCode: "",
    });
    expect(result.ok || result.error.kind).toBe("UsernameInvalid");
    expect(await services.players.countPlayers()).toBe(0);
  });

  it("deletes the new credentials again if saving the player fails (compensation)", async () => {
    services.players.insert = async () => {
      throw new Error("database hiccup");
    };
    await expect(register("jack")).rejects.toThrow("database hiccup");
    expect(identity.deletedUserIds).toEqual([UserId.of("user-1")]);
  });
});

describe("signIn and getActor", () => {
  it("signs in with the right password, case-insensitively for the username", async () => {
    await register("jack");
    const result = await accounts.signIn(
      { username: "Jack", password: "secret-password" },
      new Headers(),
    );
    expect(result.ok && result.value.username).toBe("jack");
  });

  it("answers wrong password and unknown user identically", async () => {
    await register("jack");
    const wrongPassword = await accounts.signIn(
      { username: "jack", password: "nope-nope" },
      new Headers(),
    );
    const unknownUser = await accounts.signIn(
      { username: "nobody", password: "secret-password" },
      new Headers(),
    );
    expect(wrongPassword).toEqual(err({ kind: "InvalidCredentials" }));
    expect(unknownUser).toEqual(wrongPassword);
  });

  it("refuses disabled players and signs them out everywhere (rule 8)", async () => {
    const { admin, player } = await adminAndPlayer();
    const oldBrowser = identity.headersFor(player.userId);
    await accounts.setDisabled(admin, { userId: player.userId, disabled: true });

    expect(await accounts.getActor(oldBrowser)).toBeNull();
    expect(
      await accounts.signIn({ username: "jack", password: "secret-password" }, new Headers()),
    ).toEqual(err({ kind: "AccountDisabled" }));
    expect(identity.activeSessionCount(player.userId)).toBe(0);
  });

  it("returns the signed-in actor, or null when signed out", async () => {
    const jack = await register("jack");
    const browser = identity.headersFor(jack.userId);
    expect((await accounts.getActor(browser))?.username).toBe("jack");

    await accounts.signOut(browser);
    expect(await accounts.getActor(browser)).toBeNull();
    expect(await accounts.getActor(new Headers())).toBeNull();
  });
});

describe("admin actions require an admin (rule 9)", () => {
  it("forbids regular players from every admin action", async () => {
    const { admin, player } = await adminAndPlayer();
    const regular = toActor(player);
    const forbidden = err({ kind: "Forbidden" });

    expect(await accounts.createInvite(regular, { validForDays: 7 })).toEqual(forbidden);
    expect(await accounts.revokeInvite(regular, { code: "AAAA-AAAA-0001" })).toEqual(forbidden);
    expect(await accounts.setAdmin(regular, { userId: admin.userId, isAdmin: false })).toEqual(
      forbidden,
    );
    expect(
      await accounts.setSelfFunding(regular, { userId: player.userId, allowed: true }),
    ).toEqual(forbidden);
    expect(await accounts.setDisabled(regular, { userId: admin.userId, disabled: true })).toEqual(
      forbidden,
    );
    expect(await accounts.resetPassword(regular, { userId: admin.userId })).toEqual(forbidden);
  });
});

describe("setAdmin (rule 6)", () => {
  it("promotes a player, and then allows demoting either admin", async () => {
    const { admin, player } = await adminAndPlayer();
    const promoted = await accounts.setAdmin(admin, { userId: player.userId, isAdmin: true });
    expect(promoted.ok && promoted.value.isAdmin).toBe(true);

    const demoted = await accounts.setAdmin(admin, { userId: admin.userId, isAdmin: false });
    expect(demoted.ok && demoted.value.isAdmin).toBe(false);
  });

  it("refuses to demote the last active admin, even yourself", async () => {
    const { admin } = await adminAndPlayer();
    expect(await accounts.setAdmin(admin, { userId: admin.userId, isAdmin: false })).toEqual(
      err({ kind: "LastAdmin" }),
    );
  });

  it("reports an unknown player", async () => {
    const admin = toActor(await register("admin"));
    expect(await accounts.setAdmin(admin, { userId: UserId.of("ghost"), isAdmin: true })).toEqual(
      err({ kind: "PlayerNotFound" }),
    );
  });
});

describe("setDisabled (rules 6, 7 and 8)", () => {
  it("refuses to disable yourself", async () => {
    const { admin } = await adminAndPlayer();
    expect(await accounts.setDisabled(admin, { userId: admin.userId, disabled: true })).toEqual(
      err({ kind: "CannotDisableSelf" }),
    );
  });

  it("can enable a disabled player again", async () => {
    const { admin, player } = await adminAndPlayer();
    await accounts.setDisabled(admin, { userId: player.userId, disabled: true });
    const enabled = await accounts.setDisabled(admin, { userId: player.userId, disabled: false });
    expect(enabled.ok && enabled.value.disabledAt).toBeNull();
  });
});

describe("setSelfFunding", () => {
  it("toggles the permission", async () => {
    const { admin, player } = await adminAndPlayer();
    const allowed = await accounts.setSelfFunding(admin, {
      userId: player.userId,
      allowed: true,
    });
    expect(allowed.ok && allowed.value.canSelfFund).toBe(true);
  });
});

describe("resetPassword and changeOwnPassword", () => {
  it("sets a temporary password, forces a change, and ends sessions", async () => {
    const { admin, player } = await adminAndPlayer();
    identity.headersFor(player.userId);

    const reset = await accounts.resetPassword(admin, { userId: player.userId });
    expect(reset).toEqual(ok({ temporaryPassword: "temp-password-1" }));
    expect(identity.activeSessionCount(player.userId)).toBe(0);

    const signedIn = await accounts.signIn(
      { username: "jack", password: "temp-password-1" },
      new Headers(),
    );
    expect(signedIn.ok && signedIn.value.mustChangePassword).toBe(true);
  });

  it("changing your password clears the forced-change flag", async () => {
    const { admin, player } = await adminAndPlayer();
    await accounts.resetPassword(admin, { userId: player.userId });
    const browser = identity.headersFor(player.userId);
    const actor = await accounts.getActor(browser);
    if (actor === null) throw new Error("test setup: not signed in");

    const changed = await accounts.changeOwnPassword(
      actor,
      { currentPassword: "temp-password-1", newPassword: "brand-new-secret" },
      browser,
    );
    expect(changed).toEqual(ok());
    expect((await accounts.getActor(browser))?.mustChangePassword).toBe(false);
    expect(identity.passwordOf(player.userId)).toBe("brand-new-secret");
  });

  it("rejects a wrong current password", async () => {
    const jack = await register("jack");
    const browser = identity.headersFor(jack.userId);
    const result = await accounts.changeOwnPassword(
      toActor(jack),
      { currentPassword: "wrong-one", newPassword: "brand-new-secret" },
      browser,
    );
    expect(result).toEqual(err({ kind: "InvalidCredentials" }));
  });
});

describe("invites", () => {
  it("creates codes that expire after the chosen number of days", async () => {
    const admin = toActor(await register("admin"));
    const invite = await accounts.createInvite(admin, { validForDays: 3 });
    expect(invite.ok && invite.value.expiresAt.toISOString()).toBe("2026-01-04T12:00:00.000Z");
  });

  it("rejects durations outside 1–30 days", async () => {
    const admin = toActor(await register("admin"));
    expect(await accounts.createInvite(admin, { validForDays: 90 })).toEqual(
      err({ kind: "InviteDurationInvalid" }),
    );
  });
});
