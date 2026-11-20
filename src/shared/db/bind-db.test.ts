import { describe, expect, expectTypeOf, it } from "vitest";
import { UserId } from "@/shared/kernel";
import { bindDb, bindPublicDb } from "./bind-db";
import type { DbExecutor } from "./client";

// bindDb drops the database from every query. Its other job, refusing a query that takes a plain
// UserId, is a type check: the `@ts-expect-error` line fails `pnpm typecheck` if it ever compiles.

const db = { name: "the database" } as unknown as DbExecutor;

const queries = {
  async countFor(given: DbExecutor, label: string, times: number) {
    return `${(given as unknown as { name: string }).name}: ${label} x${times}`;
  },
  async everything(given: DbExecutor) {
    return (given as unknown as { name: string }).name;
  },
};

describe("bindDb", () => {
  it("passes the database as the first argument and keeps the rest", async () => {
    const bound = bindDb(db, queries);
    expect(await bound.countFor("pulls", 2)).toBe("the database: pulls x2");
    expect(await bound.everything()).toBe("the database");
  });

  it("keeps each query's parameter list, so hover and call checks still work", () => {
    const bound = bindDb(db, queries);
    expectTypeOf(bound.countFor).parameters.toEqualTypeOf<[label: string, times: number]>();
    expectTypeOf(bound.everything).parameters.toEqualTypeOf<[]>();
  });

  it("refuses a query that takes a plain UserId after the database", () => {
    const risky = {
      async ownedBy(given: DbExecutor, userId: UserId) {
        return [given, userId];
      },
    };
    // @ts-expect-error a player read takes the Actor, never a UserId from the caller
    bindDb(db, risky);
  });
});

describe("bindPublicDb", () => {
  it("accepts a read whose credential is a token", async () => {
    const reads = bindPublicDb(db, {
      async byToken(given: DbExecutor, token: string) {
        return [given, token].length;
      },
    });
    expect(await reads.byToken("secret")).toBe(2);
  });

  it("refuses a read that takes a UserId or a player", () => {
    const byId = {
      async decksOf(given: DbExecutor, userId: UserId) {
        return [given, userId];
      },
    };
    const byPlayer = {
      async decksOf(given: DbExecutor, actor: { userId: UserId }) {
        return [given, actor];
      },
    };
    // @ts-expect-error a visitor's read can't take a UserId
    bindPublicDb(db, byId);
    // @ts-expect-error nor a player
    bindPublicDb(db, byPlayer);
  });
});
