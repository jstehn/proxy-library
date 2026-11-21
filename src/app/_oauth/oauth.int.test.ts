// OAuth for web connectors end to end (design doc 30, section 12): the discovery documents,
// registration and token endpoints as Next calls them, against real Postgres, then the token
// signing in to the MCP endpoint. The approval page's use case stands in for the browser.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCore } from "@/server/composition/core";
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
const { POST: tools } = await import("@/app/api/tools/[name]/route");

afterAll(async () => {
  await db.execute(sql`delete from oauth_clients where name in ('Claude test', 'Google test')`);
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
      token_endpoint_auth_methods_supported: ["none", "client_secret_basic", "client_secret_post"],
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

// Design doc 69: confidential clients, end to end through the route handlers.

function registrationRequest(body: unknown): Request {
  return new Request(`${origin}/api/oauth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "Google-test" },
    body: JSON.stringify(body),
  });
}

/** Registers a confidential client and returns an approved code for it. */
async function confidentialClient(method: string, scopes: string[] = ["decks:write"]) {
  const registered = await register(
    registrationRequest({
      client_name: "Google test",
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: method,
    }),
  );
  expect(registered.status).toBe(201);
  const body = await registered.json();
  const approved = await core.accounts.approveAuthorization(
    actor("jack"),
    {
      clientId: body.client_id,
      redirectUri: REDIRECT,
      responseType: "code",
      codeChallenge: CHALLENGE,
      codeChallengeMethod: "S256",
      scope: null,
      state: null,
    },
    scopes,
  );
  if (!approved.ok) throw new Error(approved.error.kind);
  const code = new URL(approved.value.redirectTo).searchParams.get("code") ?? "";
  return { body, code };
}

function codeFields(clientId: string, code: string): Record<string, string> {
  return {
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT,
    code_verifier: VERIFIER,
    ...(clientId === "" ? {} : { client_id: clientId }),
  };
}

function withHeaders(request: Request, headers: Record<string, string>): Request {
  return new Request(request, { headers: { ...Object.fromEntries(request.headers), ...headers } });
}

describe("confidential clients", () => {
  it("registers with a secret, stores only its hash, and the token works with Basic", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { body, code } = await confidentialClient("client_secret_basic");
    expect(body).toMatchObject({
      token_endpoint_auth_method: "client_secret_basic",
      client_secret_expires_at: 0,
    });
    expect(body.client_secret).toMatch(/^pls_/);

    const [stored] = (
      await db.execute<{ client_secret_hash: string; auth_method: string }>(sql`
        select client_secret_hash, auth_method from oauth_clients where client_id = ${body.client_id}
      `)
    ).rows;
    expect(stored.auth_method).toBe("client_secret_basic");
    expect(stored.client_secret_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(body.client_secret);

    const basic = `Basic ${btoa(`${body.client_id}:${body.client_secret}`)}`;
    const swapped = await token(
      withHeaders(tokenRequest(codeFields("", code)), { Authorization: basic }),
    );
    expect(swapped.status).toBe(200);
    const issued = await swapped.json();
    expect((await mcp(mcpRequest(`Bearer ${issued.access_token}`))).status).toBe(200);

    // The log has what the client asked for and no secret.
    const logged = info.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain("oauth registration");
    expect(logged).toContain(REDIRECT);
    expect(logged).not.toContain(body.client_secret);
    info.mockRestore();
  });

  it("accepts client_secret_post, and refuses a wrong or missing secret with a 401 challenge", async () => {
    const { body, code } = await confidentialClient("client_secret_post");
    const attempts = [
      codeFields(body.client_id, code),
      { ...codeFields(body.client_id, code), client_secret: "pls_wrong" },
    ];
    for (const fields of attempts) {
      const refused = await token(tokenRequest(fields));
      expect(refused.status).toBe(401);
      expect(refused.headers.get("WWW-Authenticate")).toContain("Basic");
      expect(await refused.json()).toMatchObject({ error: "invalid_client" });
    }
    // The failed tries didn't use the code up.
    const swapped = await token(
      tokenRequest({ ...codeFields(body.client_id, code), client_secret: body.client_secret }),
    );
    expect(swapped.status).toBe(200);
  });

  it("refuses the secret sent both ways", async () => {
    const { body, code } = await confidentialClient("client_secret_basic");
    const both = await token(
      withHeaders(
        tokenRequest({ ...codeFields(body.client_id, code), client_secret: body.client_secret }),
        { Authorization: `Basic ${btoa(`${body.client_id}:${body.client_secret}`)}` },
      ),
    );
    expect(both.status).toBe(400);
    expect(await both.json()).toMatchObject({ error: "invalid_request" });
  });

  it("answers an unsupported method and 21 redirect URIs with a reason, and logs both", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const method = await register(
      registrationRequest({
        client_name: "Google test",
        redirect_uris: [REDIRECT],
        token_endpoint_auth_method: "private_key_jwt",
      }),
    );
    expect(method.status).toBe(400);
    expect(await method.json()).toMatchObject({ error: "invalid_client_metadata" });
    const many = await register(
      registrationRequest({
        client_name: "Google test",
        redirect_uris: Array.from({ length: 21 }, (_, index) => `https://vendor.example/${index}`),
      }),
    );
    expect(many.status).toBe(400);
    expect(await many.json()).toMatchObject({ error: "invalid_redirect_uri" });
    const logged = info.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain('"outcome":"refused"');
    expect(logged).toContain("private_key_jwt");
    info.mockRestore();
  });

  it("gives a connector token only the scopes it was approved for, and loses it when the client is deleted", async () => {
    const { body, code } = await confidentialClient("client_secret_post", []);
    const swapped = await token(
      tokenRequest({ ...codeFields(body.client_id, code), client_secret: body.client_secret }),
    );
    const issued = await swapped.json();
    expect(issued.scope).toBe("read");

    const write = await tools(
      new Request(`${origin}/api/tools/create_deck`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${issued.access_token}`,
        },
        body: JSON.stringify({ name: "Nope", format: "commander" }),
      }),
      { params: Promise.resolve({ name: "create_deck" }) } as never,
    );
    expect(write.status).toBe(403);

    const deleted = await core.accounts.deleteOAuthClient(actor("jack", true), {
      clientId: body.client_id,
    });
    expect(deleted.ok).toBe(true);
    expect((await mcp(mcpRequest(`Bearer ${issued.access_token}`))).status).toBe(401);
  });
});
