import { z } from "zod";
import type { Scope } from "@/modules/accounts";
import { BINDINGS } from "./bindings";
import { capToolResponse } from "./cap-response";
import type { LlmTool, ToolContext, ToolOutcome } from "./tool";
import {
  drawSampleTool,
  edhrecLookupTool,
  editDeckConsolidated,
  findReplacementsTool,
  rulesLookupTool,
  searchCardsConsolidated,
  updateDeckConsolidated,
} from "./tools/consolidated";
import { createDeck } from "./tools/decks";
import { findCombosForDeckTool } from "./tools/library";
import { manageWishlist } from "./tools/wishlist";
import { redditResearchTool } from "./tools/reddit";
import { youtubeResearchTool } from "./tools/youtube";

// The tool registry (design doc 28, section 3.2): consolidated, token-efficient tools served
// identically by /api/mcp and /api/tools/<name>.

/** Tools not yet ported to bindings (P06–P09 move them; P09 deletes this list). */
const LEGACY_TOOLS: readonly LlmTool[] = [
  createDeck,
  updateDeckConsolidated,
  editDeckConsolidated,
  searchCardsConsolidated,
  edhrecLookupTool,
  findCombosForDeckTool,
  findReplacementsTool,
  drawSampleTool,
  rulesLookupTool,
  youtubeResearchTool,
  redditResearchTool,
  manageWishlist,
];

/** Bindings first; an old tool is served only when no binding has its name. */
export const TOOLS: readonly LlmTool[] = [
  ...BINDINGS,
  ...LEGACY_TOOLS.filter((tool) => !BINDINGS.some((binding) => binding.name === tool.name)),
];

/** House rules, for MCP's server instructions and OpenAPI's description (rule 10 repeats them). */
export const INSTRUCTIONS = [
  "Proxy Library: self-hosted MTG collection (prices in integer cents: $1.23 = 123), store, decks, and wishlist.",
  "No tool output is a recommendation; heuristic outputs (role tags, signals, mana_plan, replacements) are low-reliability and must be verified against card rules text or outside sources.",
  "Read get_deck before suggesting changes; never suggest cutting a keyCard or adding an avoid card.",
  "Workflow: (1) get_deck (pass includeText: true the first time you pull a deck; pass include: ['facts'] if needed). (2) Outside research: edhrec_lookup, youtube_research, reddit_research, find_combos, rules_lookup. (3) Catalog/ownership: search_cards (includeText=false, includePrice=false by default) and get_cards. (4) Preview/save with edit_deck (save=false -> previewId -> save=true); save research links with update_deck.",
  'Rules: prefer owned cards; move agreed cuts to "maybe" instead of deleting. Only cards in this catalog exist here. Keep Commander brackets (1-5) within target. Use manage_wishlist to save cards to buy later.',
].join("\n");

function findTool(name: string): LlmTool | undefined {
  return TOOLS.find((tool) => tool.name === name);
}

/** Why a call can't run: an unknown tool, a missing scope, or input that doesn't fit. */
export type CallProblem =
  | Readonly<{ kind: "UnknownTool" }>
  | Readonly<{ kind: "MissingScope"; scope: Scope }>
  | Readonly<{ kind: "InvalidInput"; issues: string[] }>;

export type CallResult =
  | Readonly<{ kind: "outcome"; outcome: ToolOutcome<unknown> }>
  | Readonly<{ kind: "problem"; problem: CallProblem }>;

/** Runs one tool: checks the scope (rule 3) and the input, then the tool. Defects throw. */
export async function callTool(
  context: ToolContext,
  name: string,
  rawInput: unknown,
): Promise<CallResult> {
  const tool = findTool(name);
  if (tool === undefined) return { kind: "problem", problem: { kind: "UnknownTool" } };
  if (!context.allows(tool.scope)) {
    return { kind: "problem", problem: { kind: "MissingScope", scope: tool.scope } };
  }
  const rawObj =
    typeof rawInput === "object" && rawInput !== null && !Array.isArray(rawInput)
      ? (rawInput as Record<string, unknown>)
      : {};
  const cursor =
    typeof rawObj.cursor === "number" && Number.isInteger(rawObj.cursor) && rawObj.cursor >= 0
      ? rawObj.cursor
      : 0;
  const parsed = tool.input.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return {
      kind: "problem",
      problem: {
        kind: "InvalidInput",
        issues: parsed.error.issues.map(
          (issue) => `${issue.path.join(".") || "input"}: ${issue.message}`,
        ),
      },
    };
  }
  const outcome = await tool.run(context, parsed.data);
  if (outcome.ok) {
    return {
      kind: "outcome",
      outcome: {
        ok: true,
        value: capToolResponse(outcome.value, tool.pagesItself === true ? 0 : cursor),
      },
    };
  }
  return { kind: "outcome", outcome };
}

/** A problem in words, for the model. */
export function problemMessage(problem: CallProblem): string {
  switch (problem.kind) {
    case "UnknownTool":
      return "There's no tool by that name.";
    case "MissingScope":
      return `This access token may not do that: it needs the "${problem.scope}" scope. The player can make a token with it on their Account page.`;
    case "InvalidInput":
      return `The input doesn't fit: ${problem.issues.join("; ")}.`;
  }
}

/** A tool's input as JSON Schema, as the caller sends it (defaults may be left out). */
export function inputJsonSchema(tool: LlmTool): Record<string, unknown> {
  const schema = z.toJSONSchema(tool.input, { io: "input" }) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}
