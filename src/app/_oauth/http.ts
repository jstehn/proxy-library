import "server-only";
import { z } from "zod";
import { SCOPES } from "@/modules/accounts";
import { getContainer } from "@/server/container";
import { assertNever } from "@/shared/kernel";

// OAuth for web connectors (design doc 30, section 9): the discovery documents, client
// registration and the token endpoint. The approval page is app/oauth/authorize.

/** Browser-based MCP tools call these from another origin; none of them uses a cookie. */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version",
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { ...CORS_HEADERS, "Cache-Control": "no-store" },
  });
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** The app's public origin: the OAuth issuer, and where every endpoint lives. */
function issuer(): string {
  return new URL(getContainer().config.appUrl).origin;
}

/** Where a client finds out how to sign in to the MCP endpoint (RFC 9728). */
export function resourceMetadataUrl(): string {
  return `${issuer()}/.well-known/oauth-protected-resource`;
}

/** GET /.well-known/oauth-protected-resource (RFC 9728). */
export function protectedResourceMetadata(): Response {
  const origin = issuer();
  return json({
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    scopes_supported: SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: "Proxy Library",
  });
}

/** GET /.well-known/oauth-authorization-server (RFC 8414). */
export function authorizationServerMetadata(): Response {
  const origin = issuer();
  return json({
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: SCOPES,
  });
}

const RegistrationBody = z.object({
  client_name: z.string().max(500).optional(),
  redirect_uris: z.array(z.string()).max(20),
});

/** POST /api/oauth/register (RFC 7591): public clients only, so no secret is handed out. */
export async function registerClient(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_client_metadata", error_description: "Send JSON." }, 400);
  }
  const parsed = RegistrationBody.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: "invalid_client_metadata", error_description: "redirect_uris is required." },
      400,
    );
  }
  const result = await getContainer().accounts.registerOAuthClient({
    clientName: parsed.data.client_name,
    redirectUris: parsed.data.redirect_uris,
  });
  if (!result.ok) {
    return json({ error: "invalid_redirect_uri", error_description: result.error.reason }, 400);
  }
  const client = result.value;
  return json(
    {
      client_id: client.clientId,
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
      client_name: client.name,
      redirect_uris: client.redirectUris,
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    201,
  );
}

/** POST /api/oauth/token (RFC 6749, section 4.1.3): a form, answered with JSON. */
export async function exchangeToken(request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json(
      { error: "invalid_request", error_description: "Send application/x-www-form-urlencoded." },
      400,
    );
  }
  const field = (name: string): string | null => {
    const value = form.get(name);
    return typeof value === "string" && value !== "" ? value : null;
  };
  const result = await getContainer().accounts.exchangeAuthorizationCode({
    grantType: field("grant_type"),
    code: field("code"),
    clientId: field("client_id"),
    redirectUri: field("redirect_uri"),
    codeVerifier: field("code_verifier"),
  });
  if (!result.ok) {
    const { error, description } = result.error;
    return json({ error, error_description: description }, 400);
  }
  // No expires_in and no refresh token: access tokens last until revoked (design doc 30).
  return json({
    access_token: result.value.accessToken,
    token_type: "Bearer",
    scope: result.value.scopes.join(" "),
  });
}

/** Words for an approval-page problem that is shown, not redirected (rule 2). */
export function problemWords(kind: "UnknownClient" | "RedirectUriNotRegistered"): string {
  switch (kind) {
    case "UnknownClient":
      return "This app isn't registered with Proxy Library. Try connecting it again from the app.";
    case "RedirectUriNotRegistered":
      return "This app asked to send you back to an address it didn't register, so it can't be approved.";
    default:
      return assertNever(kind);
  }
}
