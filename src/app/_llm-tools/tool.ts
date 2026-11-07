import type { z } from "zod";
import type { Actor, Scope } from "@/modules/accounts";
import type { Core } from "@/server/core";

// What an LLM tool is (design doc 28, section 3.2): defined once, served by both endpoints (MCP
// at /api/mcp, plain HTTP described by OpenAPI at /api/tools). A tool is a thin controller: its
// input is already checked against its schema, it calls existing queries and use cases with
// the token's Actor, and it turns their expected failures into sentences a model can act on.

/** Who is calling, what their token may do, and the app's services. */
export type ToolContext = Readonly<{
  actor: Actor;
  scopes: readonly Scope[];
  container: Core;
}>;

/** An expected failure, for the model: its kind and what to do next (invariant 8). */
export type ToolError = Readonly<{ kind: string; message: string }>;

export type ToolOutcome<Output> =
  Readonly<{ ok: true; value: Output }> | Readonly<{ ok: false; error: ToolError }>;

/** The input schema is always a flat object (invariant 9). */
export type ToolInputSchema = z.ZodObject<z.ZodRawShape>;

export type LlmTool<Input extends ToolInputSchema = ToolInputSchema> = Readonly<{
  /** verb_noun: "search_for_deck". */
  name: string;
  title: string;
  /** The tool's instructions: what it does, when to use it, how to read the result (3.4). */
  description: string;
  scope: Scope;
  /** True for tools that change nothing (MCP's readOnlyHint). */
  readOnly: boolean;
  input: Input;
  run(context: ToolContext, input: z.output<Input>): Promise<ToolOutcome<unknown>>;
}>;

/** Writes a tool with its input's type worked out from its schema. */
export function defineTool<Input extends ToolInputSchema>(tool: LlmTool<Input>): LlmTool {
  return tool as unknown as LlmTool;
}

export function done<Output>(value: Output): ToolOutcome<Output> {
  return { ok: true, value };
}

export function failed(kind: string, message: string): ToolOutcome<never> {
  return { ok: false, error: { kind, message } };
}

/** Money as both a number and words: { cents: 123, text: "$1.23" }. */
export type MoneyView = Readonly<{ cents: number; text: string }>;

export function money(cents: number): MoneyView {
  const whole = Math.round(cents);
  const sign = whole < 0 ? "-" : "";
  const absolute = Math.abs(whole);
  const dollars = Math.floor(absolute / 100).toLocaleString("en-US");
  return { cents: whole, text: `${sign}$${dollars}.${String(absolute % 100).padStart(2, "0")}` };
}

export function moneyOrNull(cents: number | null | undefined): MoneyView | null {
  return cents === null || cents === undefined ? null : money(cents);
}

/** The usual answer when a deck id isn't the caller's. */
export function deckNotFound(deckId: number): ToolOutcome<never> {
  return failed(
    "DeckNotFound",
    `Deck ${deckId} isn't one of your decks. Call list_decks to see their ids.`,
  );
}

/** The usual answer when a card name doesn't match. */
export function cardNotFound(card: string): ToolOutcome<never> {
  return failed(
    "CardNotFound",
    `No card named "${card}" in this catalog. Check the spelling, or find it with search_cards.`,
  );
}
