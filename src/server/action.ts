import type { z } from "zod";
import type { Actor } from "@/modules/accounts";
import { err, ok, type Result } from "@/shared/kernel";
import type { Capabilities } from "./capabilities";
import type { Reads } from "./reads";

// The one adapter helper (ADR 0026). A server action, a route and a tool binding all do the same
// three things: find out who is calling, parse the input with the capability's schema, and call
// capabilities (or read through `reads`) from the composition root. This helper does the first
// and last for the action.

export type ActionContext = Readonly<{ actor: Actor; capabilities: Capabilities; reads: Reads }>;

/** The input didn't fit the schema: what was wrong, as sentences. */
export type ActionInputError = Readonly<{ kind: "InvalidInput"; issues: readonly string[] }>;

export type ActionSources = Readonly<{
  /** The signed-in player (sends visitors who aren't signed in to the sign-in page). */
  requireActor(): Promise<Actor>;
  capabilities(): Capabilities;
  reads(): Reads;
}>;

/** Builds `action` from where the actor and the capabilities come from (fakes in tests). */
export function makeAction(sources: ActionSources) {
  return function action<Schema extends z.ZodType, Output>(
    schema: Schema,
    handler: (context: ActionContext, input: z.output<Schema>) => Promise<Output>,
  ): (rawInput: unknown) => Promise<Result<Output, ActionInputError>> {
    return async function run(rawInput) {
      const actor = await sources.requireActor();
      const parsed = schema.safeParse(rawInput);
      if (!parsed.success) {
        return err({
          kind: "InvalidInput",
          issues: parsed.error.issues.map(
            (issue) => `${issue.path.join(".") || "input"}: ${issue.message}`,
          ),
        });
      }
      return ok(
        await handler(
          { actor, capabilities: sources.capabilities(), reads: sources.reads() },
          parsed.data,
        ),
      );
    };
  };
}
