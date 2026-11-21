import "server-only";
import { z } from "zod";
import { basicCredentials, CLIENT_AUTH_METHODS, SCOPES } from "@/modules/accounts";
import { getContainer } from "@/server/container";
import type { RedirectUriNotRegistered, UnknownClient } from "@/modules/accounts";
import { assertNever } from "@/shared/kernel";

// OAuth for web connectors (design doc 30, section 9): the discovery documents, client
// registration and the token endpoint. The approval page is app/oauth/authorize.

/** Browser-based MCP tools call these from another origin; none of them uses a cookie. */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version",
};

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return Response.json(body, {
    status,
    headers: { ...CORS_HEADERS, "Cache-Control": "no-store", ...extraHeaders },
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
    token_endpoint_auth_methods_supported: CLIENT_AUTH_METHODS,
    scopes_supported: SCOPES,
  });
}

const RegistrationBody = z.object({
  client_name: z.string().max(500).optional(),
  redirect_uris: z.array(z.string()).max(200),
  token_endpoint_auth_method: z.string().max(100).optional(),
  grant_types: z.array(z.string().max(100)).max(20).optional(),
  response_types: z.array(z.string().max(100)).max(20).optional(),
});

type RegistrationLog = Readonly<{
  outcome: "accepted" | "refused";
  reason?: string;
  clientName?: string;
  redirectUris?: readonly string[];
  authMethod?: string;
  grantTypes?: readonly string[];
  userAgent: string | null;
}>;

/**
 * One line per registration (design doc 69, section 2), so a connector that fails to connect can
 * be diagnosed. It records what the client asked for and why it was refused: never a secret.
 */
function logRegistration(entry: RegistrationLog): void {
  console.info(`oauth registration ${JSON.stringify(entry)}`);
}

/** POST /api/oauth/register (RFC 7591): a client may ask for a secret, which is shown once. */
export async function registerClient(request: Request): Promise<Response> {
  const userAgent = request.headers.get("user-agent")?.slice(0, 120) ?? null;
  const refuse = (reason: string, description: string, extra: Partial<RegistrationLog> = {}) => {
    logRegistration({ outcome: "refused", reason, userAgent, ...extra });
    return json({ error: "invalid_client_metadata", error_description: description }, 400);
  };
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return refuse("the body isn't JSON", "Send JSON.");
  }
  const parsed = RegistrationBody.safeParse(body);
  if (!parsed.success) {
    return refuse("the body doesn't match RFC 7591", "redirect_uris is required.");
  }
  const asked = {
    clientName: parsed.data.client_name?.slice(0, 100),
    redirectUris: parsed.data.redirect_uris.slice(0, 25).map((uri) => uri.slice(0, 300)),
    authMethod: parsed.data.token_endpoint_auth_method,
    grantTypes: parsed.data.grant_types,
  };
  const result = await getContainer().accounts.registerOAuthClient({
    clientName: parsed.data.client_name,
    redirectUris: parsed.data.redirect_uris,
    authMethod: parsed.data.token_endpoint_auth_method,
  });
  if (!result.ok) {
    logRegistration({ outcome: "refused", reason: result.error.reason, ...asked, userAgent });
    return json({ error: result.error.error, error_description: result.error.reason }, 400);
  }
  logRegistration({ outcome: "accepted", ...asked, userAgent });
  const { client, clientSecret } = result.value;
  return json(
    {
      client_id: client.clientId,
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
      client_name: client.name,
      redirect_uris: client.redirectUris,
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: client.authMethod,
      ...(clientSecret === null
        ? {}
        : { client_secret: clientSecret, client_secret_expires_at: 0 }),
    },
    201,
  );
}

const CHALLENGE_HEADERS = { "WWW-Authenticate": 'Basic realm="Proxy Library"' };

type ClientCredentials =
  | Readonly<{ ok: true; clientId: string | null; clientSecret: string | null }>
  | Readonly<{ ok: false; status: number; body: object; headers: Record<string, string> }>;

/**
 * Who is calling the token endpoint: `client_secret_basic` (a header) or `client_secret_post`
 * (form fields). Sending the secret both ways, or two different ids, is refused (RFC 6749, 2.3).
 */
function clientCredentials(
  authorization: string | null,
  field: (name: string) => string | null,
): ClientCredentials {
  const failure = (status: number, error: string, description: string): ClientCredentials => ({
    ok: false,
    status,
    body: { error, error_description: description },
    headers: status === 401 ? CHALLENGE_HEADERS : {},
  });
  const basic = basicCredentials(authorization);
  if (authorization !== null && /^basic\s/i.test(authorization) && basic === null) {
    return failure(
      401,
      "invalid_client",
      "The Authorization header isn't valid Basic credentials.",
    );
  }
  const postedSecret = field("client_secret");
  const postedId = field("client_id");
  if (basic !== null && postedSecret !== null) {
    return failure(400, "invalid_request", "Authenticate the client one way only.");
  }
  if (basic !== null && postedId !== null && postedId !== basic.id) {
    return failure(400, "invalid_request", "client_id differs from the Authorization header.");
  }
  return {
    ok: true,
    clientId: basic?.id ?? postedId,
    clientSecret: (basic?.secret ?? postedSecret) || null,
  };
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
  const credentials = clientCredentials(request.headers.get("authorization"), field);
  if (!credentials.ok) return json(credentials.body, credentials.status, credentials.headers);
  const result = await getContainer().accounts.exchangeAuthorizationCode({
    grantType: field("grant_type"),
    code: field("code"),
    clientId: credentials.clientId,
    redirectUri: field("redirect_uri"),
    codeVerifier: field("code_verifier"),
    clientSecret: credentials.clientSecret,
  });
  if (!result.ok) {
    const { error, description } = result.error;
    return error === "invalid_client"
      ? json({ error, error_description: description }, 401, CHALLENGE_HEADERS)
      : json({ error, error_description: description }, 400);
  }
  // No expires_in and no refresh token: access tokens last until revoked (design doc 30).
  return json({
    access_token: result.value.accessToken,
    token_type: "Bearer",
    scope: result.value.scopes.join(" "),
  });
}

/** Words for an approval-page problem that is shown, not redirected (rule 2). */
export function problemWords(problem: UnknownClient | RedirectUriNotRegistered): string {
  switch (problem.kind) {
    case "UnknownClient":
      return "This app isn't registered with Proxy Library. Try connecting it again from the app.";
    case "RedirectUriNotRegistered": {
      const sent =
        problem.sentUri === null
          ? "This app didn't say where to send you back, and it has several addresses registered"
          : `This app asked to send you back to ${problem.sentUri}, which it did not register`;
      return `${sent}. Registered: ${problem.registeredUris.join(", ")}. It can't be approved.`;
    }
    default:
      return assertNever(problem);
  }
}
