import { describe, expect, expectTypeOf, it } from "vitest";
import { testActor, testAdminActor } from "@/modules/accounts/testing/actors";
import type { Capabilities } from "./composition/capabilities";
import { makeReadPage, type PageSources } from "./page";
import type { PublicReads, Reads } from "./composition/reads";

const actor = testActor({ name: "jack" });
const capabilities = { marker: true } as unknown as Capabilities;
const reads = { marker: "player reads" } as unknown as Reads;
const publicReads = { marker: "visitor reads" } as unknown as PublicReads;

/** Sources that sign `actor` in, with fakes for everything else; each test overrides what it checks. */
function sources(overrides: Partial<PageSources> = {}): PageSources {
  return {
    requireActor: async () => actor,
    requireAdminActor: async () => testAdminActor(),
    currentActor: async () => actor,
    capabilities: () => capabilities,
    reads: () => reads,
    publicReads: () => publicReads,
    ...overrides,
  };
}

describe("readPage", () => {
  it("gives a signed-in page the actor, the capabilities and the reads", async () => {
    const context = await makeReadPage(sources())();
    expect(context.actor).toBe(actor);
    expect(context.capabilities).toBe(capabilities);
    expect(context.reads).toBe(reads);
  });

  it("lets a visitor through only when the page allows visitors", async () => {
    const readPage = makeReadPage(
      sources({
        requireActor: async () => {
          throw new Error("redirected to sign-in");
        },
        currentActor: async () => null,
      }),
    );
    await expect(readPage()).rejects.toThrow("redirected");
    expect((await readPage({ allowVisitors: true })).actor).toBeNull();
  });

  it("gives a visitor only the public reads, and a signed-in player every read", async () => {
    const visitor = await makeReadPage(sources({ currentActor: async () => null }))({
      allowVisitors: true,
    });
    expect(visitor.reads).toBe(publicReads);

    const player = await makeReadPage(sources())({ allowVisitors: true });
    expect(player.reads).toBe(reads);
    // Narrowing on `actor` after destructuring picks the matching reads type.
    const { actor: who, reads: given } = player;
    if (who !== null) expectTypeOf(given).toEqualTypeOf<Reads>();
    else expectTypeOf(given).toEqualTypeOf<PublicReads>();
  });

  it("asks for an admin when the page says so, and hands over an AdminActor", async () => {
    const asked: string[] = [];
    const admin = testAdminActor();
    const readPage = makeReadPage(
      sources({
        requireActor: async () => {
          asked.push("player");
          return actor;
        },
        requireAdminActor: async () => {
          asked.push("admin");
          return admin;
        },
      }),
    );
    const context = await readPage({ admin: true });
    expect(asked).toEqual(["admin"]);
    expect(context.actor).toBe(admin);
    expect(context.reads).toBe(reads);
  });
});
