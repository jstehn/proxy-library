import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { testActor, testAdminActor } from "@/modules/accounts/testing/actors";
import { err, ok } from "@/shared/kernel";
import type { Capabilities } from "./capabilities";
import {
  blankAsUndefined,
  checkbox,
  makeFormAction,
  type FormRunner,
  type FormState,
} from "./form-action";
import type { Reads } from "./reads";

const player = testActor({ name: "jack" });
const admin = testAdminActor();
const capabilities = { marker: true } as unknown as Capabilities;
const reads = { marker: "reads" } as unknown as Reads;

class Redirected extends Error {
  constructor(readonly path: string) {
    super(`redirected to ${path}`);
  }
}

/** A formAction with fakes: the actor, an admin, and a `redirect` that throws like Next's. */
function build(signedIn = true) {
  return makeFormAction({
    requireActor: async () => {
      if (!signedIn) throw new Redirected("/sign-in");
      return player;
    },
    requireAdminActor: async () => admin,
    capabilities: () => capabilities,
    reads: () => reads,
    redirect: (path) => {
      throw new Redirected(path);
    },
  });
}

function form(entries: Array<[string, string | File]>): FormData {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

const describeError = (error: { kind: string }) => `Failed: ${error.kind}`;

describe("formAction", () => {
  it("reads the fields, calls the handler with the actor, capabilities and reads, and shows success", async () => {
    const formAction = build();
    let seen: unknown;
    const save = formAction(
      z.object({ name: z.string(), count: z.coerce.number() }),
      async (context, input) => {
        seen = {
          who: context.actor.username,
          ...input,
          same: context.capabilities === capabilities,
        };
        return ok("done");
      },
      { describeError, successMessage: "Saved." },
    );
    const state = await save(
      form([
        ["name", "Jack"],
        ["count", "3"],
        ["ignored", "x"],
      ]),
    );
    expect(state).toEqual({ message: "Saved.", tone: "success" });
    expect(seen).toEqual({ who: "jack", name: "Jack", count: 3, same: true });
  });

  it("keeps every value of a repeated key when the schema's field is a list", async () => {
    const formAction = build();
    let seen: unknown;
    const save = formAction(
      z.object({
        ids: z.array(z.string()),
        maybe: z.array(z.string()).optional(),
        withDefault: z.array(z.string()).default([]),
        single: z.string(),
      }),
      async (_context, input) => {
        seen = input;
        return ok(null);
      },
      { describeError },
    );
    await save(
      form([
        ["ids", "a"],
        ["ids", "b"],
        ["maybe", "c"],
        ["maybe", "d"],
        ["single", "x"],
        ["single", "y"],
      ]),
    );
    // A list field gets every value; any other field gets the first.
    expect(seen).toEqual({ ids: ["a", "b"], maybe: ["c", "d"], withDefault: [], single: "x" });
  });

  it("reads an unchecked box as false and a checked one as true", async () => {
    const formAction = build();
    const seen: boolean[] = [];
    const save = formAction(
      z.object({ shared: checkbox() }),
      async (_context, input) => {
        seen.push(input.shared);
        return ok(null);
      },
      { describeError },
    );
    await save(form([]));
    await save(form([["shared", "on"]]));
    expect(seen).toEqual([false, true]);
  });

  it("keeps blank text as an empty string, unless the schema says blank means none", async () => {
    const formAction = build();
    let seen: unknown;
    const save = formAction(
      z.object({ note: z.string(), nickname: blankAsUndefined(z.string().min(2)) }),
      async (_context, input) => {
        seen = input;
        return ok(null);
      },
      { describeError },
    );
    await save(
      form([
        ["note", ""],
        ["nickname", ""],
      ]),
    );
    expect(seen).toEqual({ note: "", nickname: undefined });
  });

  it("returns the problems as the form's error and skips the handler", async () => {
    const formAction = build();
    let called = false;
    const save = formAction(
      z.object({ name: z.string().min(1, "can't be empty"), age: z.coerce.number().min(18) }),
      async () => {
        called = true;
        return ok(null);
      },
      { describeError },
    );
    const state = await save(
      form([
        ["name", ""],
        ["age", "3"],
      ]),
    );
    expect(called).toBe(false);
    expect(state.tone).toBe("error");
    expect(state.message).toContain("name: can't be empty");
    expect(state.message).toContain("age: ");
    expect(state.message).toContain("; ");
  });

  it("says the form's own sentence when the input is rejected and one is given", async () => {
    const save = build()(z.object({ amount: z.string() }), async () => ok(null), {
      describeError,
      invalidInput: "Enter an amount.",
    });
    expect(await save(form([]))).toEqual({ message: "Enter an amount.", tone: "error" });
  });

  it("treats a file where text is expected as a problem", async () => {
    const save = build()(z.object({ name: z.string() }), async () => ok(null), { describeError });
    const state = await save(form([["name", new File(["x"], "x.txt")]]));
    expect(state.tone).toBe("error");
    expect(state.message).toContain("name: ");
  });

  it("turns a Result error into the module's sentence", async () => {
    const save = build()(z.object({}), async () => err({ kind: "NotEnoughMoney" }), {
      describeError,
    });
    expect(await save(form([]))).toEqual({ message: "Failed: NotEnoughMoney", tone: "error" });
  });

  it("redirects after success when asked to, with a path made from the value", async () => {
    const formAction = build();
    const fixed = formAction(z.object({}), async () => ok(7), {
      describeError,
      redirectTo: "/done",
    });
    await expect(fixed(form([]))).rejects.toMatchObject({ path: "/done" });
    const computed = formAction(z.object({}), async () => ok(7), {
      describeError,
      redirectTo: (id) => `/decks/${id}`,
    });
    await expect(computed(form([]))).rejects.toMatchObject({ path: "/decks/7" });
  });

  it("lets a defect and a redirect from the handler through", async () => {
    const formAction = build();
    const broken = formAction(
      z.object({}),
      async () => {
        throw new Error("database is down");
      },
      { describeError },
    );
    await expect(broken(form([]))).rejects.toThrow("database is down");
    const away = formAction(
      z.object({}),
      async () => {
        throw new Redirected("/elsewhere");
      },
      { describeError },
    );
    await expect(away(form([]))).rejects.toMatchObject({ path: "/elsewhere" });
  });

  it("checks the session first: a signed-out visitor goes to sign-in and the handler never runs", async () => {
    let called = false;
    const save = build(false)(
      z.object({}),
      async () => {
        called = true;
        return ok(null);
      },
      { describeError },
    );
    await expect(save(form([]))).rejects.toMatchObject({ path: "/sign-in" });
    expect(called).toBe(false);
  });

  it("hands an admin form the AdminActor", async () => {
    let seen: unknown;
    const save = build()(
      z.object({}),
      async (context) => {
        seen = context.actor;
        return ok(null);
      },
      { describeError, admin: true },
    );
    await save(form([]));
    expect(seen).toBe(admin);
  });

  it("also works with useActionState: the previous state comes first, the form data last", async () => {
    const save = build()(z.object({ name: z.string() }), async () => ok(null), {
      describeError,
      successMessage: "Saved.",
    });
    const previous: FormState = { message: null, tone: null };
    expect(await save(previous, form([["name", "x"]]))).toEqual({
      message: "Saved.",
      tone: "success",
    });
    expectTypeOf(save).toEqualTypeOf<FormRunner>();
  });
});
