import { describe, expect, it } from "vitest";
import { loadConfig } from "./index";

const validEnv = {
  DATABASE_URL: "postgres://tcg@localhost/tcg",
  AUTH_SECRET: "x".repeat(32),
  APP_URL: "http://localhost:3000",
  IMAGE_CACHE_DIR: "/tmp/images",
  SYNC_CACHE_DIR: "/tmp/cache",
};

describe("loadConfig", () => {
  it("maps a valid environment to config", () => {
    expect(loadConfig({ ...validEnv, NODE_ENV: "test" })).toEqual({
      nodeEnv: "test",
      databaseUrl: "postgres://tcg@localhost/tcg",
      authSecret: "x".repeat(32),
      appUrl: "http://localhost:3000",
      imageCacheDir: "/tmp/images",
      syncCacheDir: "/tmp/cache",
      syncTime: { hour: 4, minute: 0 },
    });
  });

  it("defaults NODE_ENV to development", () => {
    expect(loadConfig(validEnv).nodeEnv).toBe("development");
  });

  it("leaves sign-in with an OpenID Connect provider off unless all three variables are set", () => {
    expect(loadConfig(validEnv).oidc).toBeUndefined();
    // An empty value (a compose file passing `${OIDC_ISSUER_URL:-}` through) counts as unset.
    expect(
      loadConfig({ ...validEnv, OIDC_ISSUER_URL: "", OIDC_CLIENT_ID: "" }).oidc,
    ).toBeUndefined();
    const oidc = {
      OIDC_ISSUER_URL: "https://auth.example/application/o/proxy-library/",
      OIDC_CLIENT_ID: "client",
      OIDC_CLIENT_SECRET: "secret",
    };
    expect(loadConfig({ ...validEnv, ...oidc }).oidc).toEqual({
      issuerUrl: "https://auth.example/application/o/proxy-library/",
      clientId: "client",
      clientSecret: "secret",
      providerName: "Authentik",
    });
    expect(loadConfig({ ...validEnv, ...oidc, OIDC_PROVIDER_NAME: "SSO" }).oidc?.providerName).toBe(
      "SSO",
    );
  });

  it("refuses a half-set OpenID Connect group and an insecure issuer", () => {
    expect(() => loadConfig({ ...validEnv, OIDC_CLIENT_ID: "client" })).toThrow(
      /OIDC_ISSUER_URL[\s\S]*OIDC_CLIENT_SECRET|OIDC_CLIENT_SECRET[\s\S]*OIDC_ISSUER_URL/,
    );
    const rest = { OIDC_CLIENT_ID: "client", OIDC_CLIENT_SECRET: "secret" };
    expect(() =>
      loadConfig({ ...validEnv, ...rest, OIDC_ISSUER_URL: "http://auth.example/o/" }),
    ).toThrow(/https/);
    expect(() => loadConfig({ ...validEnv, ...rest, OIDC_ISSUER_URL: "nonsense" })).toThrow(
      /OIDC_ISSUER_URL/,
    );
    expect(
      loadConfig({ ...validEnv, ...rest, OIDC_ISSUER_URL: "http://127.0.0.1:9000/o/" }).oidc,
    ).toBeDefined();
  });

  it("fails fast, naming the problem variable", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ ...validEnv, DATABASE_URL: "mysql://nope" })).toThrow(
      /postgres:\/\//,
    );
    expect(() => loadConfig({ ...validEnv, AUTH_SECRET: "short" })).toThrow(/AUTH_SECRET/);
    expect(() => loadConfig({ ...validEnv, APP_URL: "not a url" })).toThrow(/APP_URL/);
    expect(() => loadConfig({ ...validEnv, SYNC_TIME: "25:00" })).toThrow(/SYNC_TIME/);
  });
});
