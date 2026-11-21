// A fake OpenID Connect provider for tests (design doc 69, section 10), standing in for
// Authentik. It runs in the process: `fetch` answers the requests the app would send the
// issuer (discovery, keys, the token endpoint), and `authorize` plays the browser's trip
// through the provider's sign-in page. No socket, no network.
//
// The documents have the shape of Authentik's, but they are generated here: they weren't
// recorded from the real instance.
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";

export type FakeIdentity = Readonly<{ sub: string; email: string; emailVerified?: boolean }>;

/** What can go wrong with the ID token, one thing at a time. */
export type Misbehaviour = Readonly<{
  issuer?: string;
  audience?: string;
  expired?: boolean;
  nonce?: string;
  /** Signed with a key the JWKS doesn't list. */
  unknownKey?: boolean;
}>;

type IssuerOptions = Readonly<{ issuerUrl: string; clientId: string; clientSecret: string }>;
type PendingCode = {
  identity: FakeIdentity;
  nonce: string | null;
  challenge: string;
  redirectUri: string;
  misbehaviour: Misbehaviour;
};

const KEY_ID = "test-key";

function base64Url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

export function fakeOidcIssuer(options: IssuerOptions) {
  const issuerUrl = options.issuerUrl.replace(/\/+$/, "") + "/";
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const otherKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  const codes = new Map<string, PendingCode>();

  const discovery = {
    issuer: issuerUrl,
    authorization_endpoint: `${issuerUrl}authorize/`,
    token_endpoint: `${issuerUrl}token/`,
    userinfo_endpoint: `${issuerUrl}userinfo/`,
    jwks_uri: `${issuerUrl}jwks/`,
    response_types_supported: ["code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["openid", "email", "profile"],
  };
  const jwks = {
    keys: [
      {
        ...publicKey.export({ format: "jwk" }),
        kid: KEY_ID,
        alg: "RS256",
        use: "sig",
      },
    ],
  };

  function signedToken(claims: object, key: typeof privateKey): string {
    const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: KEY_ID }));
    const body = base64Url(JSON.stringify(claims));
    const signature = sign("RSA-SHA256", Buffer.from(`${header}.${body}`), key);
    return `${header}.${body}.${base64Url(signature)}`;
  }

  function idTokenFor(pending: PendingCode): string {
    const { identity, misbehaviour } = pending;
    const now = Math.floor(Date.now() / 1000);
    return signedToken(
      {
        iss: misbehaviour.issuer ?? issuerUrl,
        aud: misbehaviour.audience ?? options.clientId,
        sub: identity.sub,
        email: identity.email,
        email_verified: identity.emailVerified ?? true,
        name: identity.email,
        nonce: misbehaviour.nonce ?? pending.nonce ?? undefined,
        iat: now - (misbehaviour.expired ? 7200 : 0),
        exp: now + (misbehaviour.expired ? -3600 : 3600),
      },
      misbehaviour.unknownKey ? otherKey : privateKey,
    );
  }

  function json(body: unknown, status = 200): Response {
    return Response.json(body, { status });
  }

  async function token(request: Request): Promise<Response> {
    const form = new URLSearchParams(await request.text());
    const basic = /^Basic (.+)$/.exec(request.headers.get("authorization") ?? "");
    const [basicId, basicSecret] = basic
      ? Buffer.from(basic[1], "base64").toString().split(":")
      : [];
    const clientId = basicId ?? form.get("client_id");
    const clientSecret = basicSecret ?? form.get("client_secret");
    if (clientId !== encodeURIComponent(options.clientId) && clientId !== options.clientId) {
      return json({ error: "invalid_client" }, 401);
    }
    if (
      clientSecret !== options.clientSecret &&
      clientSecret !== encodeURIComponent(options.clientSecret)
    ) {
      return json({ error: "invalid_client" }, 401);
    }
    const pending = codes.get(form.get("code") ?? "");
    codes.delete(form.get("code") ?? "");
    const verifier = form.get("code_verifier") ?? "";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    if (
      pending === undefined ||
      form.get("grant_type") !== "authorization_code" ||
      challenge !== pending.challenge ||
      form.get("redirect_uri") !== pending.redirectUri
    ) {
      return json({ error: "invalid_grant" }, 400);
    }
    return json({
      access_token: randomBytes(16).toString("hex"),
      token_type: "Bearer",
      expires_in: 3600,
      id_token: idTokenFor(pending),
    });
  }

  return {
    issuerUrl,
    /** Answers the requests the app sends the issuer; install it as `globalThis.fetch`. */
    async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const request = new Request(input, init);
      const { pathname } = new URL(request.url);
      const base = new URL(issuerUrl).pathname;
      if (!request.url.startsWith(issuerUrl)) {
        throw new Error(`A test tried to call ${request.url}. Tests stay offline.`);
      }
      switch (pathname.slice(base.length)) {
        case ".well-known/openid-configuration":
          return json(discovery);
        case "jwks/":
          return json(jwks);
        case "token/":
          return token(request);
        default:
          return json({ error: "not_found" }, 404);
      }
    },
    /**
     * The browser's trip: the authorization URL the app sent, the identity that signs in there,
     * and the address the provider sends the browser back to (with a code and the state).
     */
    authorize(authorizationUrl: string, identity: FakeIdentity, misbehaviour: Misbehaviour = {}) {
      const url = new URL(authorizationUrl);
      const parameter = (name: string) => url.searchParams.get(name);
      if (!authorizationUrl.startsWith(discovery.authorization_endpoint)) {
        throw new Error(`not this issuer's authorization endpoint: ${authorizationUrl}`);
      }
      if (parameter("client_id") !== options.clientId) throw new Error("wrong client_id");
      if (parameter("code_challenge_method") !== "S256") throw new Error("PKCE S256 is required");
      if (!parameter("scope")?.split(" ").includes("openid")) throw new Error("scope lacks openid");
      const code = randomBytes(12).toString("hex");
      const redirectUri = parameter("redirect_uri") ?? "";
      codes.set(code, {
        identity,
        nonce: parameter("nonce"),
        challenge: parameter("code_challenge") ?? "",
        redirectUri,
        misbehaviour,
      });
      const back = new URL(redirectUri);
      back.searchParams.set("code", code);
      back.searchParams.set("state", parameter("state") ?? "");
      return back.toString();
    },
  };
}

export type FakeOidcIssuer = ReturnType<typeof fakeOidcIssuer>;
