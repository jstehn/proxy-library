// OAuth for web connectors end to end (design doc 30, section 12): the discovery documents,
// registration and token endpoints as Next calls them, against real Postgres, then the token
// signing in to the MCP endpoint. The approval page's use case stands in for the browser.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCore } from "@/server/core";
import { loadConfig } from "@/shared/config";
import { actor, close, db, resetPlayers } from "../../../tests/integration/harness";
import { sql } from "drizzle-orm";

vi.mock("server-only", () => ({}));

const core = buildCore(loadConfig());
globalThis.__tcgContainer = core;
const origin = new URL(core.config.appUrl).origin;

const { GET: protectedResource } =
  await import("@/app/.well-known/oauth-protected-resource/[[...resource]]/route");
const { GET: authorizationServer } =
  await import("@/app/.well-known/oauth-authorization-server/[[...issuer]]/route");
const { POST: register } = await import("@/app/api/oauth/register/route");
const { POST: token } = await import("@/app/api/oauth/token/route");
const { POST: mcp } = await import("@/app/api/mcp/route");

afterAll(async () => {
  await db.execute(sql`delete from oauth_clients where name = 'Claude test'`);
  globalThis.__tcgContainer = undefined;
  await core.close();
  await close();
});
beforeEach(() => resetPlayers(["jack"]));

const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

function mcpRequest(authorization?: string): Request {
  return new Request(`${origin}/api/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(authorization === undefined ? {} : { Authorization: authorization }),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
}

function tokenRequest(fields: Record<string, string>): Request {
  return new Request(`${origin}/api/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
}

describe("OAuth for web connectors", () => {
  it("points a signed-out MCP client at the metadata, which points at the endpoints", async () => {
    const refused = await mcp(mcpRequest());
    expect(refused.status).toBe(401);
    expect(refused.headers.get("WWW-Authenticate")).toContain(
      `resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
    );

    const resource = await protectedResource().json();
    expect(resource).toMatchObject({
      resource: `${origin}/api/mcp`,
      authorization_servers: [origin],
    });
    const server = await authorizationServer().json();
    expect(server).toMatchObject({
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/api/oauth/token`,
      registration_endpoint: `${origin}/api/oauth/register`,
      code_challenge_methods_supported: ["S256"],
    });
  });

  it("registers, approves, swaps the code once, and the token signs in to MCP", async () => {
    const registered = await register(
      new Request(`${origin}/api/oauth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_name: "Claude test", redirect_uris: [REDIRECT] }),
      }),
    );
    expect(registered.status).toBe(201);
    const { client_id: clientId } = await registered.json();

    const approved = await core.accounts.approveAuthorization(
      actor("jack"),
      {
        clientId,
        redirectUri: REDIRECT,
        responseType: "code",
        codeChallenge: CHALLENGE,
        codeChallengeMethod: "S256",
        scope: null,
        state: "abc",
      },
      ["decks:write"],
    );
    if (!approved.ok) throw new Error(approved.error.kind);
    const code = new URL(approved.value.redirectTo).searchParams.get("code") ?? "";

    const fields = {
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_verifier: VERIFIER,
    };
    const swapped = await token(tokenRequest(fields));
    expect(swapped.status).toBe(200);
    const body = await swapped.json();
    expect(body).toMatchObject({ token_type: "Bearer", scope: "read decks:write" });

    const again = await token(tokenRequest(fields));
    expect(again.status).toBe(400);
    expect(await again.json()).toMatchObject({ error: "invalid_grant" });

    const listed = await mcp(mcpRequest(`Bearer ${body.access_token}`));
    expect(listed.status).toBe(200);
    expect(JSON.stringify(await listed.json())).toContain("get_deck");

    const [row] = (
      await db.execute<{ name: string; oauth_client_id: string }>(sql`
        select name, oauth_client_id from access_tokens
         where user_id = 'jack' and revoked_at is null
      `)
    ).rows;
    expect(row).toEqual({ name: "Claude test (connected app)", oauth_client_id: clientId });
  });

  it("refuses registration with an http redirect URI", async () => {
    const refused = await register(
      new Request(`${origin}/api/oauth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: "Claude test",
          redirect_uris: ["http://evil.example"],
        }),
      }),
    );
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: "invalid_redirect_uri" });
  });
});
