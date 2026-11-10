import { beforeEach, describe, expect, it } from "vitest";
import { manualClock } from "@/shared/kernel/testing";
import { MAX_LIVE_TOKENS } from "../domain/access-token";
import { toActor, type Actor } from "../domain/player";
import {
  inMemoryAccountsServices,
  inMemoryAccountsUnitOfWork,
  inMemoryIdentityProvider,
  sequentialSecretGenerator,
} from "../testing/fakes";
import { makeAccounts } from "./make-accounts";
import type { AuthorizationParameters } from "./oauth";
import type { AccountsServices } from "./ports";

// OAuth for web connectors (design doc 30, section 5), against in-memory fakes.

const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
// RFC 7636's example pair.
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

let services: AccountsServices;
let clock: ReturnType<typeof manualClock>;
let accounts: ReturnType<typeof makeAccounts>;
let admin: Actor;
let jack: Actor;
let clientId: string;

beforeEach(async () => {
  services = inMemoryAccountsServices();
  clock = manualClock("2026-11-10T12:00:00Z");
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
  const client = await accounts.registerOAuthClient({
    clientName: "Claude",
    redirectUris: [REDIRECT],
  });
  if (!client.ok) throw new Error(client.error.kind);
  clientId = client.value.clientId;
});

function parameters(overrides: Partial<AuthorizationParameters> = {}): AuthorizationParameters {
  return {
    clientId,
    redirectUri: REDIRECT,
    responseType: "code",
    codeChallenge: CHALLENGE,
    codeChallengeMethod: "S256",
    scope: "read decks:write",
    state: "xyz",
    ...overrides,
  };
}

/** Approves as jack and returns the code from the redirect. */
async function approve(scopes: string[] = ["decks:write"]): Promise<string> {
  const result = await accounts.approveAuthorization(jack, parameters(), scopes);
  if (!result.ok) throw new Error(result.error.kind);
  const url = new URL(result.value.redirectTo);
  expect(url.origin + url.pathname).toBe(REDIRECT);
  expect(url.searchParams.get("state")).toBe("xyz");
  return url.searchParams.get("code") ?? "";
}

function exchange(code: string, overrides: { verifier?: string; clientId?: string } = {}) {
  return accounts.exchangeAuthorizationCode({
    grantType: "authorization_code",
    code,
    clientId: overrides.clientId ?? clientId,
    redirectUri: REDIRECT,
    codeVerifier: overrides.verifier ?? VERIFIER,
  });
}

describe("registering a client", () => {
  it("refuses a redirect URI that isn't https or local, and an empty list", async () => {
    const bad = await accounts.registerOAuthClient({ redirectUris: ["http://evil.example/cb"] });
    expect(bad).toMatchObject({ ok: false, error: { kind: "OAuthClientInvalid" } });
    const none = await accounts.registerOAuthClient({ redirectUris: [] });
    expect(none.ok).toBe(false);
  });
});

describe("checking a request (rules 2 and 3)", () => {
  it("reads the client and the scopes it asked for", async () => {
    const checked = await accounts.checkAuthorizationRequest(parameters());
    expect(checked).toMatchObject({
      ok: true,
      value: { client: { name: "Claude" }, scopes: ["read", "decks:write"], state: "xyz" },
    });
  });

  it("shows an unknown client or unregistered redirect URI, rather than redirecting", async () => {
    expect(await accounts.checkAuthorizationRequest(parameters({ clientId: "plc_nope" }))).toEqual({
      ok: false,
      error: { kind: "UnknownClient" },
    });
    expect(
      await accounts.checkAuthorizationRequest(parameters({ redirectUri: "https://evil.example" })),
    ).toEqual({ ok: false, error: { kind: "RedirectUriNotRegistered" } });
  });

  it("uses the only registered redirect URI when the request leaves it out", async () => {
    const checked = await accounts.checkAuthorizationRequest(parameters({ redirectUri: null }));
    expect(checked).toMatchObject({ ok: true, value: { redirectUri: REDIRECT } });
  });

  it("sends a request without PKCE S256 back to the client", async () => {
    const plain = await accounts.checkAuthorizationRequest(
      parameters({ codeChallengeMethod: "plain" }),
    );
    expect(plain).toMatchObject({
      ok: false,
      error: { kind: "AuthorizationRefused", error: "invalid_request", redirectUri: REDIRECT },
    });
  });
});

describe("approving and swapping the code", () => {
  it("makes an access token with the chosen scopes, which signs in", async () => {
    const issued = await exchange(await approve());
    if (!issued.ok) throw new Error(issued.error.description);
    expect(issued.value.scopes).toEqual(["read", "decks:write"]);
    const actor = await accounts.actorFromToken(`Bearer ${issued.value.accessToken}`);
    expect(actor).toMatchObject({
      actor: { userId: jack.userId },
      scopes: ["read", "decks:write"],
    });
  });

  it("uses a code once (rule 4)", async () => {
    const code = await approve();
    expect((await exchange(code)).ok).toBe(true);
    expect(await exchange(code)).toMatchObject({ ok: false, error: { error: "invalid_grant" } });
  });

  it("refuses an expired code, the wrong verifier, or another client's code", async () => {
    const expired = await approve();
    clock.advanceBy(10 * 60_000 + 1);
    expect((await exchange(expired)).ok).toBe(false);

    const wrongVerifier = await approve();
    expect((await exchange(wrongVerifier, { verifier: "x".repeat(43) })).ok).toBe(false);
    // The failed swap used the code up.
    expect((await exchange(wrongVerifier)).ok).toBe(false);

    const otherClient = await approve();
    expect((await exchange(otherClient, { clientId: "plc_other" })).ok).toBe(false);
  });

  it("replaces the client's earlier token when you connect it again (rule 7)", async () => {
    const first = await exchange(await approve());
    const second = await exchange(await approve());
    if (!first.ok || !second.ok) throw new Error("exchange failed");
    expect(await accounts.actorFromToken(`Bearer ${first.value.accessToken}`)).toBeNull();
    expect(await accounts.actorFromToken(`Bearer ${second.value.accessToken}`)).not.toBeNull();
    expect(await services.accessTokens.countLive(jack.userId)).toBe(1);
  });

  it("says so before handing out a code when the token limit is reached", async () => {
    for (let index = 0; index < MAX_LIVE_TOKENS; index += 1) {
      await accounts.createAccessToken(jack, { name: `Token ${index}`, scopes: [] });
    }
    const result = await accounts.approveAuthorization(jack, parameters(), []);
    expect(result).toEqual({ ok: false, error: { kind: "TooManyTokens", maximum: 10 } });
  });

  it("gives a disabled player's code no token", async () => {
    const code = await approve();
    await accounts.setDisabled(admin, { userId: jack.userId, disabled: true });
    expect(await exchange(code)).toMatchObject({ ok: false, error: { error: "invalid_grant" } });
  });

  it("denies with access_denied, keeping the state", async () => {
    const denied = await accounts.denyAuthorization(parameters());
    if (!denied.ok) throw new Error(denied.error.kind);
    const url = new URL(denied.value.redirectTo);
    expect(url.searchParams.get("error")).toBe("access_denied");
    expect(url.searchParams.get("state")).toBe("xyz");
  });
});
