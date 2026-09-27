import { describe, expect, it } from "vitest";
import { loadConfig } from "./index";

describe("loadConfig", () => {
  it("maps a valid environment to config", () => {
    const config = loadConfig({ DATABASE_URL: "postgres://tcg@localhost/tcg", NODE_ENV: "test" });
    expect(config).toEqual({ nodeEnv: "test", databaseUrl: "postgres://tcg@localhost/tcg" });
  });

  it("defaults NODE_ENV to development", () => {
    expect(loadConfig({ DATABASE_URL: "postgres://x/y" }).nodeEnv).toBe("development");
  });

  it("fails fast, naming the problem variable", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ DATABASE_URL: "mysql://nope" })).toThrow(/postgres:\/\//);
  });
});
