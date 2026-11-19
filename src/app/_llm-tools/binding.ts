import type { z } from "zod";
import type { Actor, Scope } from "@/modules/accounts";
import type { Result } from "@/shared/kernel";
import type { Capabilities } from "@/server/capabilities";
import { defineTool, type LlmTool, type ToolError, type ToolInputSchema } from "./tool";

// A tool binding (ADR 0026): the LLM adapter over one capability. It may do three things: parse
// the input (the schema), call capabilities, and present the answer as JSON for the model. Logic,
// queries and other adapters stay out. The transports (mcp.ts, openapi.ts, http.ts) serve every
// binding the same way.

/** Who called and with what, for `present` (e.g. to name the player). */
export type BindingRequest<Input extends ToolInputSchema> = Readonly<{
  actor: Actor;
  scopes: readonly Scope[];
  input: z.output<Input>;
}>;

export type Binding<Input extends ToolInputSchema, Value, Failure> = Readonly<{
  /** verb_noun: "list_decks". */
  name: string;
  title: string;
  /** What it does, when to use it, how to read the result. */
  description: string;
  scope: LlmTool["scope"];
  readOnly: boolean;
  /** True when the binding reads `cursor` and pages its own output. */
  pagesItself?: boolean;
  /** A flat object schema, usually the capability's own schema with `.describe()` text added. */
  input: Input;
  /** Calls the capability as the token's player. */
  call(
    capabilities: Capabilities,
    actor: Actor,
    input: z.output<Input>,
  ): Promise<Result<Value, Failure>>;
  /** The capability's answer as JSON for the model. `request` says who asked and with what. */
  present(value: Value, request: BindingRequest<Input>): unknown;
  /**
   * An expected failure as a sentence the model can act on. Comes from the module's
   * `describe…Error`; leave it out only when the capability cannot fail.
   */
  describeError?(failure: Failure, request: BindingRequest<Input>): ToolError;
}>;

/** Writes a binding. The result is what the transports serve. */
export function defineBinding<Input extends ToolInputSchema, Value, Failure>(
  binding: Binding<Input, Value, Failure>,
): LlmTool {
  return defineTool({
    name: binding.name,
    title: binding.title,
    description: binding.description,
    scope: binding.scope,
    readOnly: binding.readOnly,
    pagesItself: binding.pagesItself,
    input: binding.input,
    async run(context, input) {
      const result = await binding.call(context.capabilities, context.actor, input);
      if (result.ok)
        return {
          ok: true,
          value: binding.present(result.value, {
            actor: context.actor,
            scopes: context.scopes,
            input,
          }),
        };
      if (binding.describeError === undefined) {
        throw new Error(
          `${binding.name}: the capability failed and the binding has no describeError`,
        );
      }
      return {
        ok: false,
        error: binding.describeError(result.error, {
          actor: context.actor,
          scopes: context.scopes,
          input,
        }),
      };
    },
  });
}
