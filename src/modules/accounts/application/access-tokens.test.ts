import { beforeEach, describe, expect, it } from "vitest";
import { manualClock } from "@/shared/kernel/testing";
import { AccessTokenId, MAX_LIVE_TOKENS, tokenHash } from "../domain/access-token";
import { toActor, type Actor } from "../domain/player";
import {
  inMemoryAccountsServices,
  inMemoryAccountsUnitOfWork,
  inMemoryIdentityProvider,
  sequentialSecretGenerator,
} from "../testing/fakes";
import { makeAccounts } from "./make-accounts";
import type { AccountsServices } from "./ports";

// Personal access tokens (design doc 28, section 5.1), against in-memory fakes.

let services: AccountsServices;
let clock: ReturnType<typeof manualClock>;
let accounts: ReturnType<typeof makeAccounts>;
let admin: Actor;
let jack: Actor;

beforeEach(async () => {
  services = inMemoryAccountsServices();
  clock = manualClock("2026-11-07T12:00:00Z");
  accounts = makeAccounts({
    unitOfWork: inMemoryAccountsUnitOfWork(services),
    identity: inMemoryIdentityProvider(),
    secrets: sequentialSecretGenerator(),
    clock,
  });
  const register = async (username: string, inviteCode = "") => {
    const result = await accounts.registerPlayer({
      username,
      displayName: username,
      password: "secret-password",
      inviteCode,
    });
    if (!result.ok) throw new Error(result.error.kind);
    return toActor(result.value);
  };
  admin = await register("admin");
  const invite = await accounts.createInvite(admin, { validForDays: 7 });
  if (!invite.ok) throw new Error(invite.error.kind);
  jack = await register("jack", invite.value.code);
});

async function create(actor: Actor, scopes: string[] = []) {
  const result = await accounts.createAccessToken(actor, { name: "LM Studio", scopes });
  if (!result.ok) throw new Error(result.error.kind);
  return result.value;
}

describe("createAccessToken", () => {
  it("returns the secret once and stores only its hash (rule 2)", async () => {
    const { token, secret } = await create(jack, ["decks:write"]);
    expect(secret).toMatch(/^pl_[A-Za-z0-9_-]{43}$/);
    expect(token).toMatchObject({
      name: "LM Studio",
      prefix: secret.slice(3, 11),
      scopes: ["read", "decks:write"],
      lastUsedAt: null,
      revokedAt: null,
    });
    expect(JSON.stringify(token)).not.toContain(secret);
  });

  it("refuses an empty or long name", async () => {
    const result = await accounts.createAccessToken(jack, { name: " ", scopes: [] });
    expect(result).toEqual({ ok: false, error: { kind: "TokenNameInvalid", maximum: 60 } });
  });

  it(`allows at most ${MAX_LIVE_TOKENS} live tokens; revoking makes room (rule 16)`, async () => {
    const tokens = [];
    for (let index = 0; index < MAX_LIVE_TOKENS; index++) tokens.push(await create(jack));
    const tooMany = await accounts.createAccessToken(jack, { name: "one more", scopes: [] });
    expect(tooMany).toEqual({ ok: false, error: { kind: "TooManyTokens", maximum: 10 } });
    await accounts.revokeAccessToken(jack, tokens[0].token.id);
    expect((await accounts.createAccessToken(jack, { name: "now", scopes: [] })).ok).toBe(true);
  });
});

describe("actorFromToken (rule 1)", () => {
  it("finds the player and the token's scopes", async () => {
    const { token, secret } = await create(jack, ["wishlist:write"]);
    expect(await accounts.actorFromToken(`Bearer ${secret}`)).toEqual({
      actor: jack,
      scopes: ["read", "wishlist:write"],
      tokenId: token.id,
    });
  });

  it("is null for no header, a malformed or unknown token, and a revoked one", async () => {
    const { token, secret } = await create(jack);
    expect(await accounts.actorFromToken(null)).toBeNull();
    expect(await accounts.actorFromToken(secret)).toBeNull(); // not "Bearer …"
    expect(await accounts.actorFromToken("Bearer pl_short")).toBeNull();
    expect(await accounts.actorFromToken(`Bearer pl_${"Z".repeat(43)}`)).toBeNull();
    await accounts.revokeAccessToken(jack, token.id);
    expect(await accounts.actorFromToken(`Bearer ${secret}`)).toBeNull();
  });

  it("records when it was last used, at most once a minute", async () => {
    const { token, secret } = await create(jack);
    const lastUsed = async () =>
      (await services.accessTokens.findLiveByHash(await tokenHash(secret)))?.lastUsedAt;
    await accounts.actorFromToken(`Bearer ${secret}`);
    expect(await lastUsed()).toEqual(new Date("2026-11-07T12:00:00Z"));
    clock.advanceBy(30_000);
    await accounts.actorFromToken(`Bearer ${secret}`);
    expect(await lastUsed()).toEqual(new Date("2026-11-07T12:00:00Z"));
    clock.advanceBy(30_000);
    await accounts.actorFromToken(`Bearer ${secret}`);
    expect(await lastUsed()).toEqual(new Date("2026-11-07T12:01:00Z"));
    expect(token.id).toBe(AccessTokenId.of(1));
  });

  it("is null once an admin disables the player, and stays so after enabling (rule 20)", async () => {
    const { secret } = await create(jack);
    await accounts.setDisabled(admin, { userId: jack.userId, disabled: true });
    expect(await accounts.actorFromToken(`Bearer ${secret}`)).toBeNull();
    await accounts.setDisabled(admin, { userId: jack.userId, disabled: false });
    expect(await accounts.actorFromToken(`Bearer ${secret}`)).toBeNull();
  });

  it("is null after an admin resets the player's password (rule 20)", async () => {
    const { secret } = await create(jack);
    await accounts.resetPassword(admin, { userId: jack.userId });
    expect(await accounts.actorFromToken(`Bearer ${secret}`)).toBeNull();
  });
});

describe("revokeAccessToken", () => {
  it("treats someone else's token as not found", async () => {
    const { token } = await create(jack);
    expect(await accounts.revokeAccessToken(admin, token.id)).toEqual({
      ok: false,
      error: { kind: "TokenNotFound" },
    });
    expect((await accounts.revokeAccessToken(jack, token.id)).ok).toBe(true);
    expect((await accounts.revokeAccessToken(jack, token.id)).ok).toBe(false);
  });
});
