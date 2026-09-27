// The real accounts use cases against real Postgres and real Better Auth.
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "@/shared/config";
import { createDatabase, makeDrizzleUnitOfWork } from "@/shared/db";
import { err, UserId } from "@/shared/kernel";
import { fixedClock } from "@/shared/kernel/testing";
import { makeAccounts } from "../application/make-accounts";
import { toActor, type Actor } from "../domain/player";
import { sequentialSecretGenerator } from "../testing/fakes";
import { createAuth } from "./better-auth";
import { betterAuthIdentityProvider } from "./better-auth-identity-provider";
import { drizzleInviteRepository, drizzlePlayerRepository } from "./drizzle-repositories";

const config = loadConfig();
const { db, close } = createDatabase(config.databaseUrl);
const auth = createAuth({ db, secret: config.authSecret, appUrl: config.appUrl });
const identity = betterAuthIdentityProvider(auth);

function buildAccounts() {
  return makeAccounts({
    unitOfWork: makeDrizzleUnitOfWork(db, (transaction) => ({
      players: drizzlePlayerRepository(transaction),
      invites: drizzleInviteRepository(transaction),
    })),
    identity,
    secrets: sequentialSecretGenerator(),
    clock: fixedClock("2026-01-01T12:00:00Z"),
  });
}

let accounts: ReturnType<typeof buildAccounts>;

beforeEach(async () => {
  await db.execute(sql`truncate invites, players, auth_users cascade`);
  accounts = buildAccounts();
});
afterAll(close);

/** Signs in through Better Auth and returns request headers carrying the session cookie. */
async function browserSignedInAs(username: string, password: string): Promise<Headers> {
  const response = await auth.api.signInUsername({
    body: { username, password },
    returnHeaders: true,
  });
  const cookie = response.headers.get("set-cookie");
  if (cookie === null) throw new Error("no session cookie returned");
  return new Headers({ cookie: cookie.split(";")[0] });
}

async function register(username: string, inviteCode = "") {
  const result = await accounts.registerPlayer({
    username,
    displayName: username,
    password: "secret-password",
    inviteCode,
  });
  if (!result.ok) throw new Error(`could not register ${username}: ${result.error.kind}`);
  return result.value;
}

async function registerAdminAndPlayer(): Promise<{ admin: Actor; playerId: UserId }> {
  const admin = toActor(await register("admin"));
  const invite = await accounts.createInvite(admin, { validForDays: 7 });
  if (!invite.ok) throw new Error("could not create invite");
  const player = await register("jack", invite.value.code);
  return { admin, playerId: player.userId };
}

describe("Better Auth identity", () => {
  it("registers, signs in, and recognizes the session", async () => {
    const jack = await register("jack");
    const signedIn = await accounts.signIn(
      { username: "JACK", password: "secret-password" },
      new Headers(),
    );
    expect(signedIn.ok && signedIn.value.userId).toBe(jack.userId);

    const browser = await browserSignedInAs("jack", "secret-password");
    expect((await accounts.getActor(browser))?.username).toBe("jack");
  });

  it("rejects a wrong password and a taken username", async () => {
    await register("jack");
    expect(
      await accounts.signIn({ username: "jack", password: "wrong-password" }, new Headers()),
    ).toEqual(err({ kind: "InvalidCredentials" }));
    expect(
      await accounts.registerPlayer({
        username: "jack",
        displayName: "Other Jack",
        password: "secret-password",
        inviteCode: "",
      }),
    ).toEqual(err({ kind: "InviteRequired" }));
  });

  it("changes a password, and an admin reset forces a change", async () => {
    const { admin, playerId } = await registerAdminAndPlayer();
    const browser = await browserSignedInAs("jack", "secret-password");
    const actor = await accounts.getActor(browser);
    if (actor === null) throw new Error("not signed in");

    const changed = await accounts.changeOwnPassword(
      actor,
      { currentPassword: "secret-password", newPassword: "another-secret" },
      browser,
    );
    expect(changed.ok).toBe(true);
    expect(
      (await accounts.signIn({ username: "jack", password: "another-secret" }, new Headers())).ok,
    ).toBe(true);

    const reset = await accounts.resetPassword(admin, { userId: playerId });
    if (!reset.ok) throw new Error("reset failed");
    const afterReset = await accounts.signIn(
      { username: "jack", password: reset.value.temporaryPassword },
      new Headers(),
    );
    expect(afterReset.ok && afterReset.value.mustChangePassword).toBe(true);
  });

  it("disabling a player ends their sessions and blocks sign-in", async () => {
    const { admin, playerId } = await registerAdminAndPlayer();
    const browser = await browserSignedInAs("jack", "secret-password");
    expect(await accounts.getActor(browser)).not.toBeNull();

    await accounts.setDisabled(admin, { userId: playerId, disabled: true });
    expect(await accounts.getActor(browser)).toBeNull();
    expect(
      await accounts.signIn({ username: "jack", password: "secret-password" }, new Headers()),
    ).toEqual(err({ kind: "AccountDisabled" }));
  });

  it("removes the credentials again when saving the player fails (compensation)", async () => {
    // Make every insert into `players` fail, as if the database had a problem at that moment.
    // Better Auth has already saved the credentials by then, so they must be deleted again.
    await db.execute(sql`
      create or replace function reject_player() returns trigger language plpgsql as $$
      begin raise exception 'simulated failure'; end $$`);
    await db.execute(sql`
      create trigger reject_player before insert on players
      for each row execute function reject_player()`);
    try {
      // Drizzle wraps the database error as "Failed query: …" (the original is its `cause`).
      await expect(register("mallory")).rejects.toThrow(/Failed query: insert into "players"/);
    } finally {
      await db.execute(sql`drop trigger reject_player on players`);
      await db.execute(sql`drop function reject_player`);
    }

    const users = await db.execute<{ total: number }>(
      sql`select count(*)::int as total from auth_users`,
    );
    expect(users.rows[0].total).toBe(0);
  });
});

describe("concurrency (design doc 02, section 8)", () => {
  it("two simultaneous first registrations produce exactly one admin", async () => {
    const results = await Promise.all([
      accounts.registerPlayer({
        username: "alice",
        displayName: "Alice",
        password: "secret-password",
        inviteCode: "",
      }),
      accounts.registerPlayer({
        username: "bob",
        displayName: "Bob",
        password: "secret-password",
        inviteCode: "",
      }),
    ]);

    const succeeded = results.filter((result) => result.ok);
    expect(succeeded).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([err({ kind: "InviteRequired" })]);
    const players = await db.execute<{ admins: number; total: number }>(
      sql`select count(*) filter (where is_admin)::int as admins, count(*)::int as total from players`,
    );
    expect(players.rows[0]).toEqual({ admins: 1, total: 1 });
  });

  it("two admins demoting each other at once still leaves one admin", async () => {
    const { admin, playerId } = await registerAdminAndPlayer();
    await accounts.setAdmin(admin, { userId: playerId, isAdmin: true });
    const second: Actor = { ...admin, userId: playerId, username: "jack" as Actor["username"] };

    const results = await Promise.all([
      accounts.setAdmin(admin, { userId: playerId, isAdmin: false }),
      accounts.setAdmin(second, { userId: admin.userId, isAdmin: false }),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([err({ kind: "LastAdmin" })]);
  });
});
