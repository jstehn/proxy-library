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
