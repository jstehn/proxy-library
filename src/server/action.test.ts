import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Actor } from "@/modules/accounts";
import { makeAction } from "./action";
import type { Capabilities } from "./capabilities";

const actor = { username: "jack" } as unknown as Actor;
const capabilities = { marker: true } as unknown as Capabilities;

describe("action", () => {
  const action = makeAction({ requireActor: async () => actor, capabilities: () => capabilities });

  it("gives the handler the actor, the capabilities and the parsed input", async () => {
    const run = action(z.object({ count: z.coerce.number() }), async (context, input) => ({
      who: context.actor.username,
      same: context.capabilities === capabilities,
      count: input.count,
    }));
    expect(await run({ count: "3" })).toEqual({
      ok: true,
      value: { who: "jack", same: true, count: 3 },
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
