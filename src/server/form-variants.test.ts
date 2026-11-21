import { describe, expect, it } from "vitest";
import { z } from "zod";
import { testActor, testAdminActor } from "@/modules/accounts/testing/actors";
import { ok } from "@/shared/kernel";
import type { Capabilities } from "./composition/capabilities";
import {
  makeFormAction,
  makeFormRedirect,
  makeFormVoid,
  messageByField,
  type FormActionSources,
} from "./form-action";
import type { Reads } from "./composition/reads";

// The newer form helpers: `formRedirect`, `formVoid`, union schemas, `messageByField` and
// `allowPasswordChangePending` (see form-action.test.ts for `formAction` itself).

const player = testActor({ name: "jack" });
const admin = testAdminActor();

class Redirected extends Error {
  constructor(readonly path: string) {
    super(`redirected to ${path}`);
  }
}

function fakeSources(signedIn = true, asked: unknown[] = []): FormActionSources {
  return {
    requireActor: async (options) => {
      asked.push(options);
      if (!signedIn) throw new Redirected("/sign-in");
      return player;
    },
    requireAdminActor: async () => admin,
    capabilities: () => ({}) as Capabilities,
    reads: () => ({}) as Reads,
    redirect: (path) => {
      throw new Redirected(path);
    },
  };
}

function form(entries: Array<[string, string]>): FormData {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

const describeError = (error: { kind: string }) => `Failed: ${error.kind}`;

describe("formAction, the newer options", () => {
  it("tells the session check when a pending password change is allowed", async () => {
    const asked: unknown[] = [];
    const save = makeFormAction(fakeSources(true, asked))(z.object({}), async () => ok(null), {
      describeError,
      allowPasswordChangePending: true,
    });
    await save(form([]));
    expect(asked).toEqual([{ allowPasswordChangePending: true }]);
  });

  it("reads a union by the fields of all its options and checks which one it is", async () => {
    const Request = z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("any"), finish: z.enum(["nonfoil", "foil"]) }),
      z.object({ kind: z.literal("exact"), finish: z.enum(["nonfoil", "foil", "etched"]) }),
    ]);
    const seen: unknown[] = [];
    const save = makeFormAction(fakeSources())(
      Request,
      async (_context, input) => {
        seen.push(input);
        return ok(null);
      },
      { describeError, successMessage: "Saved." },
    );
    await save(
      form([
        ["kind", "exact"],
        ["finish", "etched"],
      ]),
    );
    expect(seen).toEqual([{ kind: "exact", finish: "etched" }]);
    const refused = await save(
      form([
        ["kind", "any"],
        ["finish", "etched"],
      ]),
    );
    expect(refused.tone).toBe("error");
    expect(seen).toHaveLength(1);
  });

  it("words a rejected form per field with messageByField", async () => {
    const schema = z.object({ kind: z.string(), quantity: z.coerce.number() });
    const save = makeFormAction(fakeSources())(schema, async () => ok(null), {
      describeError,
      invalidInput: messageByField(
        { quantity: "Choose how many.", kind: "Choose a kind." },
        "Something is off.",
      ),
    });
    expect(await save(form([["kind", "x"]]))).toEqual({
      message: "Choose how many.",
      tone: "error",
    });
    expect((await save(form([["quantity", "2"]]))).message).toBe("Choose a kind.");
    const other = messageByField({}, "Something is off.");
    const problem = z.string().safeParse(1).error;
    expect(problem && other(problem)).toBe("Something is off.");
  });

  it("lets redirectTo return nothing to stay on the page and show the message", async () => {
    const save = makeFormAction(fakeSources())(z.object({}), async () => ok(1), {
      describeError,
      successMessage: "Saved.",
      redirectTo: () => undefined,
    });
    expect(await save(form([]))).toEqual({ message: "Saved.", tone: "success" });
  });
});

describe("formRedirect", () => {
  const formRedirect = makeFormRedirect(fakeSources());

  it("calls the handler with the actor and goes where it says", async () => {
    let who = "";
    const go = formRedirect(z.object({ deckId: z.coerce.number() }), async (context, input) => {
      who = context.actor.username;
      return `/decks/${input.deckId}?error=${encodeURIComponent("No.")}`;
    });
    await expect(go(form([["deckId", "4"]]))).rejects.toMatchObject({
      path: "/decks/4?error=No.",
    });
    expect(who).toBe("jack");
  });

  it("stays on the page when the handler returns nothing", async () => {
    const stay = formRedirect(z.object({}), async () => undefined);
    expect(await stay(form([]))).toBeUndefined();
  });

  it("sends a form it can't read to the `unreadable` path, or throws without one", async () => {
    const schema = z.object({ deckId: z.coerce.number().int().positive() });
    const handler = async () => "/never";
    await expect(
      formRedirect(schema, handler, { unreadable: "/decks" })(form([["deckId", "x"]])),
    ).rejects.toMatchObject({ path: "/decks" });
    await expect(formRedirect(schema, handler)(form([["deckId", "x"]]))).rejects.toThrow(
      "could not be read",
    );
  });

  it("checks the session first and hands an admin form the AdminActor", async () => {
    const signedOut = makeFormRedirect(fakeSources(false));
    await expect(signedOut(z.object({}), async () => "/x")(form([]))).rejects.toMatchObject({
      path: "/sign-in",
    });
    let seen: unknown;
    const go = formRedirect(
      z.object({}),
      async (context) => {
        seen = context.actor;
        return "/admin";
      },
      { admin: true },
    );
    await expect(go(form([]))).rejects.toMatchObject({ path: "/admin" });
    expect(seen).toBe(admin);
  });
});

describe("formVoid", () => {
  const formVoid = makeFormVoid(fakeSources());

  it("runs the handler and returns nothing", async () => {
    const seen: unknown[] = [];
    const run = formVoid(z.object({ name: z.string() }), async (_context, input) => {
      seen.push(input.name);
      return "ignored";
    });
    expect(await run(form([["name", "x"]]))).toBeUndefined();
    expect(seen).toEqual(["x"]);
  });

  it("does nothing for a form it can't read", async () => {
    let called = false;
    const run = formVoid(z.object({ id: z.coerce.number().int().positive() }), async () => {
      called = true;
    });
    expect(await run(form([["id", "x"]]))).toBeUndefined();
    expect(called).toBe(false);
  });

  it("hands an admin form the AdminActor", async () => {
    let seen: unknown;
    const run = formVoid(
      z.object({}),
      async (context) => {
        seen = context.actor;
      },
      { admin: true },
    );
    await run(form([]));
    expect(seen).toBe(admin);
  });
});
