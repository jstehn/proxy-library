// Sign-in through Authentik (design doc 69, section 4) against real Postgres and a fake issuer
// that runs in the process (tests/support/fake-oidc-issuer.ts): Better Auth's whole OpenID Connect
// round trip with PKCE, the nonce and signed ID tokens, and our linking rules on top of it.
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "@/shared/config";
import { createDatabase, makeDrizzleUnitOfWork } from "@/shared/db";
import { fixedClock } from "@/shared/kernel/testing";
import {
  fakeOidcIssuer,
  type FakeIdentity,
  type Misbehaviour,
} from "../../../../tests/support/fake-oidc-issuer";
import { makeAccounts } from "../application/make-accounts";
import { toActor, type Actor } from "../domain/player";
import { sequentialSecretGenerator } from "../testing/fakes";
import { createAuth } from "./better-auth";
import { betterAuthIdentityProvider } from "./better-auth-identity-provider";
import {
  drizzleAccessTokenRepository,
  drizzleInviteRepository,
  drizzleOAuthRepository,
  drizzlePlayerRepository,
} from "./drizzle-repositories";

const CLIENT_ID = "proxy-library-client";
const CLIENT_SECRET = "a-long-client-secret";
const issuer = fakeOidcIssuer({
  issuerUrl: "https://auth.test.invalid/application/o/proxy-library/",
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
});

// Better Auth reads the discovery document as soon as it is built, so the fake is in place first.
const realFetch = globalThis.fetch;
globalThis.fetch = issuer.fetch as typeof fetch;

const config = loadConfig();
const { db, close } = createDatabase(config.databaseUrl);
const auth = createAuth({
  db,
  secret: config.authSecret,
  appUrl: config.appUrl,
  oidc: { issuerUrl: issuer.issuerUrl, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET },
});
const accounts = makeAccounts({
  unitOfWork: makeDrizzleUnitOfWork(db, (transaction) => ({
    players: drizzlePlayerRepository(transaction),
    invites: drizzleInviteRepository(transaction),
    accessTokens: drizzleAccessTokenRepository(transaction),
    oauth: drizzleOAuthRepository(transaction),
  })),
  identity: betterAuthIdentityProvider(auth),
  secrets: sequentialSecretGenerator(),
  clock: fixedClock("2026-11-20T12:00:00Z"),
});

beforeAll(async () => {
  await auth.$context;
});
afterAll(async () => {
  globalThis.fetch = realFetch;
  await close();
});

let admin: Actor;
let jack: Actor;
let jackId: string;

beforeEach(async () => {
  await db.execute(sql`truncate invites, players, auth_users cascade`);
  await db.execute(sql`delete from auth_verifications`);
  const register = async (username: string, inviteCode: string) => {
    const result = await accounts.registerPlayer({
      username,
      displayName: username,
      password: "secret-password",
      inviteCode,
    });
    if (!result.ok) throw new Error(result.error.kind);
    return result.value;
  };
  admin = toActor(await register("admin", ""));
  const invite = await accounts.createInvite(admin, { validForDays: 7 });
  if (!invite.ok) throw new Error(invite.error.kind);
  jack = toActor(await register("jack", invite.value.code));
  jackId = jack.userId;
});

/** Cookies the browser would keep, from the Set-Cookie headers of each response. */
function cookieJar() {
  const jar = new Map<string, string>();
  return {
    keep(headers: Headers) {
      for (const line of headers.getSetCookie()) {
        const [pair] = line.split(";");
        const index = pair.indexOf("=");
        jar.set(pair.slice(0, index), pair.slice(index + 1));
      }
    },
    header: () => [...jar].map(([name, value]) => `${name}=${value}`).join("; "),
    has: (part: string) => [...jar.keys()].some((name) => name.includes(part)),
  };
}

type Outcome = Readonly<{
  location: string;
  session: boolean;
  cookies: ReturnType<typeof cookieJar>;
}>;

/** Signs in with Authentik from a fresh browser: start, the provider's page, the callback. */
async function signInWithAuthentik(
  identity: FakeIdentity,
  misbehaviour: Misbehaviour = {},
): Promise<Outcome> {
  const cookies = cookieJar();
  const started = await auth.api.signInSocial({
    body: {
      provider: "authentik",
      callbackURL: "/sign-in/finish",
      errorCallbackURL: "/sign-in",
      disableRedirect: true,
    },
    returnHeaders: true,
  });
  cookies.keep(started.headers);
  return callBack(started.response.url ?? "", identity, misbehaviour, cookies);
}

async function callBack(
  authorizationUrl: string,
  identity: FakeIdentity,
  misbehaviour: Misbehaviour,
  cookies: ReturnType<typeof cookieJar>,
): Promise<Outcome> {
  const back = issuer.authorize(authorizationUrl, identity, misbehaviour);
  const response = await auth.handler(new Request(back, { headers: { cookie: cookies.header() } }));
  expect(response.status).toBe(302);
  cookies.keep(response.headers);
  return {
    location: response.headers.get("location") ?? "",
    session: cookies.has("session_token"),
    cookies,
  };
}

/** The player signs in with their password, then links Authentik from the Account page. */
async function linkFromAccountPage(
  identity: FakeIdentity,
  misbehaviour: Misbehaviour = {},
): Promise<Outcome> {
  const cookies = cookieJar();
  const signedIn = await auth.api.signInUsername({
    body: { username: "jack", password: "secret-password" },
    returnHeaders: true,
  });
  cookies.keep(signedIn.headers);
  const started = await auth.api.linkSocialAccount({
    body: {
      provider: "authentik",
      callbackURL: "/account",
      errorCallbackURL: "/account",
      disableRedirect: true,
    },
    headers: new Headers({ cookie: cookies.header() }),
    returnHeaders: true,
  });
  cookies.keep(started.headers);
  return callBack(started.response.url, identity, misbehaviour, cookies);
}

async function links(): Promise<{ user_id: string; account_id: string }[]> {
  const result = await db.execute<{ user_id: string; account_id: string }>(
    sql`select user_id, account_id from auth_accounts where provider_id = 'authentik'`,
  );
  return result.rows;
}

async function countUsers(): Promise<number> {
  const result = await db.execute<{ total: number }>(
    sql`select count(*)::int as total from auth_users`,
  );
  return result.rows[0].total;
}

/** Who the app thinks is signed in with these cookies. */
async function actorFor(cookies: ReturnType<typeof cookieJar>) {
  return accounts.getActor(new Headers({ cookie: cookies.header() }));
}

const JACK_IN_AUTHENTIK: FakeIdentity = { sub: "hashed-sub-jack", email: "jack@example.com" };

describe("linking from the Account page", () => {
  it("links the signed-in player, with a different email, and then signs them in", async () => {
    const linked = await linkFromAccountPage(JACK_IN_AUTHENTIK);
    expect(linked.location).toBe("/account");
    expect(await links()).toEqual([{ user_id: jackId, account_id: "hashed-sub-jack" }]);

    const signedIn = await signInWithAuthentik(JACK_IN_AUTHENTIK);
    expect(signedIn.location).toBe("/sign-in/finish");
    expect(signedIn.session).toBe(true);
    expect(await actorFor(signedIn.cookies)).toMatchObject({ username: "jack", isAdmin: false });
  });

  it("refuses an Authentik account another player already linked", async () => {
    await linkFromAccountPage(JACK_IN_AUTHENTIK);
    // The same Authentik account, linked to admin: refused.
    const cookies = cookieJar();
    const signedIn = await auth.api.signInUsername({
      body: { username: "admin", password: "secret-password" },
      returnHeaders: true,
    });
    cookies.keep(signedIn.headers);
    const started = await auth.api.linkSocialAccount({
      body: {
        provider: "authentik",
        callbackURL: "/account",
        errorCallbackURL: "/account",
        disableRedirect: true,
      },
      headers: new Headers({ cookie: cookies.header() }),
      returnHeaders: true,
    });
    cookies.keep(started.headers);
    const outcome = await callBack(started.response.url, JACK_IN_AUTHENTIK, {}, cookies);
    expect(outcome.location).toContain("error=account_already_linked_to_different_user");
    expect(await links()).toHaveLength(1);
  });

  it("unlinks, and the password still works", async () => {
    const linked = await linkFromAccountPage(JACK_IN_AUTHENTIK);
    await accounts.unlinkExternal(jack, new Headers({ cookie: linked.cookies.header() }));
    expect(await links()).toEqual([]);
    const again = await signInWithAuthentik(JACK_IN_AUTHENTIK);
    expect(again.session).toBe(false);
    const password = await auth.api.signInUsername({
      body: { username: "jack", password: "secret-password" },
    });
    expect(password?.user.id).toBe(jackId);
  });
});

describe("an admin-set verified email", () => {
  it("links the first Authentik sign-in whose email matches", async () => {
    const set = await accounts.setPlayerEmail(admin, {
      userId: jackId as Actor["userId"],
      email: " Jack@Example.com ",
    });
    expect(set.ok).toBe(true);
    const signedIn = await signInWithAuthentik(JACK_IN_AUTHENTIK);
    expect(signedIn.session).toBe(true);
    expect(await links()).toEqual([{ user_id: jackId, account_id: "hashed-sub-jack" }]);
    expect(await actorFor(signedIn.cookies)).toMatchObject({ username: "jack" });
  });

  it("does not link when the email is only the placeholder, and says so", async () => {
    const outcome = await signInWithAuthentik({ sub: "someone", email: "jack@players.invalid" });
    expect(outcome.session).toBe(false);
    expect(outcome.location).toContain("error=account_not_linked");
    expect(await links()).toEqual([]);
  });

  it("only an admin may set it, and one player's email can't be another's", async () => {
    expect(
      await accounts.setPlayerEmail(jack, { userId: jack.userId, email: "x@example.com" }),
    ).toEqual({ ok: false, error: { kind: "Forbidden" } });
    await accounts.setPlayerEmail(admin, { userId: admin.userId, email: "same@example.com" });
    expect(
      await accounts.setPlayerEmail(admin, {
        userId: jackId as Actor["userId"],
        email: "same@example.com",
      }),
    ).toEqual({ ok: false, error: { kind: "EmailTaken" } });
  });
});

describe("people who are not linked, and tokens that are not right", () => {
  it("refuses an unknown Authentik user without creating a player", async () => {
    const before = await countUsers();
    const outcome = await signInWithAuthentik({ sub: "stranger", email: "stranger@example.com" });
    expect(outcome.session).toBe(false);
    expect(outcome.location).toContain("error=signup_disabled");
    expect(await countUsers()).toBe(before);
  });

  it.each<[string, Misbehaviour]>([
    ["the wrong issuer", { issuer: "https://auth.test.invalid/application/o/tududi/" }],
    ["another application's audience", { audience: "tududi-client" }],
    ["an expired token", { expired: true }],
    ["the wrong nonce", { nonce: "not-the-nonce" }],
    ["a key the JWKS doesn't list", { unknownKey: true }],
  ])("refuses %s, even for a linked player", async (_name, misbehaviour) => {
    await linkFromAccountPage(JACK_IN_AUTHENTIK);
    const outcome = await signInWithAuthentik(JACK_IN_AUTHENTIK, misbehaviour);
    expect(outcome.session).toBe(false);
    expect(outcome.location).toMatch(/^\/sign-in\?error=/);
  });

  it("refuses a callback with a state this browser never started", async () => {
    const started = await auth.api.signInSocial({
      body: { provider: "authentik", callbackURL: "/sign-in/finish", disableRedirect: true },
    });
    const back = issuer.authorize(started.url ?? "", JACK_IN_AUTHENTIK);
    // No state cookie: another browser, or a forged request.
    const response = await auth.handler(new Request(back));
    expect(response.headers.getSetCookie().join(";")).not.toContain("session_token");
    expect(response.headers.get("location") ?? "").toContain("error=");
  });

  it("signs in a disabled player's session out of the app: no actor", async () => {
    const linked = await linkFromAccountPage(JACK_IN_AUTHENTIK);
    await accounts.setDisabled(admin, { userId: jackId as Actor["userId"], disabled: true });
    const signedIn = await signInWithAuthentik(JACK_IN_AUTHENTIK);
    expect(await actorFor(signedIn.cookies)).toBeNull();
    expect(await actorFor(linked.cookies)).toBeNull();
  });
});
