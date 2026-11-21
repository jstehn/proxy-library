import { beforeEach, describe, expect, it } from "vitest";
import { manualClock } from "@/shared/kernel/testing";
import { toActor, type Actor } from "../domain/player";
import {
  inMemoryAccountsServices,
  inMemoryAccountsUnitOfWork,
  inMemoryIdentityProvider,
  sequentialSecretGenerator,
} from "../testing/fakes";
import { describeExternalLinkError, describeExternalSignInError } from "./describe-error";
import { makeAccounts } from "./make-accounts";

// Sign-in through Authentik (design doc 69), against the in-memory fakes.

let identity: ReturnType<typeof inMemoryIdentityProvider>;
let accounts: ReturnType<typeof makeAccounts>;
let admin: Actor;
let jack: Actor;

beforeEach(async () => {
  identity = inMemoryIdentityProvider();
  accounts = makeAccounts({
    unitOfWork: inMemoryAccountsUnitOfWork(inMemoryAccountsServices()),
    identity,
    secrets: sequentialSecretGenerator(),
    clock: manualClock("2026-11-20T12:00:00Z"),
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

describe("setting a player's email", () => {
  it("stores it verified, lower case", async () => {
    const result = await accounts.setPlayerEmail(admin, {
      userId: jack.userId,
      email: " Jack@Example.com",
    });
    expect(result.ok).toBe(true);
    expect(identity.emailOf(jack.userId)).toEqual({ email: "jack@example.com", verified: true });
  });

  it("puts the unverified placeholder back when emptied", async () => {
    await accounts.setPlayerEmail(admin, { userId: jack.userId, email: "jack@example.com" });
    await accounts.setPlayerEmail(admin, { userId: jack.userId, email: "  " });
    expect(identity.emailOf(jack.userId)).toEqual({
      email: "jack@players.invalid",
      verified: false,
    });
  });

  it("refuses non-admins, bad emails, unknown players and a taken email", async () => {
    const input = { userId: jack.userId, email: "jack@example.com" };
    expect(await accounts.setPlayerEmail(jack, input)).toEqual({
      ok: false,
      error: { kind: "Forbidden" },
    });
    expect(await accounts.setPlayerEmail(admin, { ...input, email: "nope" })).toMatchObject({
      ok: false,
      error: { kind: "EmailInvalid" },
    });
    expect(
      await accounts.setPlayerEmail(admin, { userId: "ghost" as Actor["userId"], email: "a@b.co" }),
    ).toEqual({ ok: false, error: { kind: "PlayerNotFound" } });
    await accounts.setPlayerEmail(admin, input);
    expect(
      await accounts.setPlayerEmail(admin, { userId: admin.userId, email: input.email }),
    ).toEqual({ ok: false, error: { kind: "EmailTaken" } });
  });
});

describe("starting and ending a link", () => {
  it("sends a visitor to the provider, keeping the next path for the finish route", async () => {
    const url = await accounts.startExternalSignIn({ next: "/decks?x=1" }, new Headers());
    expect(new URL(url ?? "").searchParams.get("callback")).toBe(
      "/sign-in/finish?next=%2Fdecks%3Fx%3D1",
    );
  });

  it("links and unlinks the signed-in player only", async () => {
    const headers = identity.headersFor(jack.userId);
    expect(await accounts.startExternalLink(jack, headers)).not.toBeNull();
    expect(identity.isLinked(jack.userId)).toBe(true);
    await accounts.unlinkExternal(jack, headers);
    expect(identity.isLinked(jack.userId)).toBe(false);
  });
});

describe("what a failed Authentik sign-in says", () => {
  it("explains an unlinked account, and falls back to a plain sentence", () => {
    expect(describeExternalSignInError(undefined)).toBeNull();
    expect(describeExternalSignInError("signup_disabled")).toMatch(/Account page/);
    expect(describeExternalSignInError("account_not_linked")).toMatch(/No Proxy Library player/);
    expect(describeExternalSignInError("disabled")).toMatch(/disabled/);
    expect(describeExternalSignInError("invalid_code")).toMatch(/didn't work/);
    expect(describeExternalLinkError("account_already_linked_to_different_user")).toMatch(
      /another player/,
    );
  });
});
