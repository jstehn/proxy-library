import { describe, expect, it } from "vitest";
import { z } from "zod";
import { testActor } from "@/modules/accounts/testing/actors";
import { makeAction } from "./action";
import type { Capabilities } from "./composition/capabilities";
import type { Reads } from "./composition/reads";

const actor = testActor({ name: "jack" });
const capabilities = { marker: true } as unknown as Capabilities;
const reads = { marker: "reads" } as unknown as Reads;

describe("action", () => {
  const action = makeAction({
    requireActor: async () => actor,
    capabilities: () => capabilities,
    reads: () => reads,
  });

  it("gives the handler the actor, the capabilities, the reads and the parsed input", async () => {
    const run = action(z.object({ count: z.coerce.number() }), async (context, input) => ({
      who: context.actor.username,
      same: context.capabilities === capabilities,
      sameReads: context.reads === reads,
      count: input.count,
    }));
    expect(await run({ count: "3" })).toEqual({
      ok: true,
      value: { who: "jack", same: true, sameReads: true, count: 3 },
    });
  });

  it("returns the problems and skips the handler when the input doesn't fit", async () => {
    let called = false;
    const run = action(z.object({ name: z.string().min(1) }), async () => {
      called = true;
    });
    const result = await run({ name: "" });
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });
});
