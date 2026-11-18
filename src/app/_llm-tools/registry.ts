import { z } from "zod";
import { allows, type Scope } from "@/modules/accounts";
import type { LlmTool, ToolContext, ToolOutcome } from "./tool";
import {
  applyChangesTool,
  auditDeckTool,
  compareToEdhrecTool,
  createDeck,
  deckSourcesTool,
  edhrecCommanderTool,
  getDeck,
  goldfishStartTool,
  goldfishStepTool,
  listDecks,
  planManaBaseTool,
  replaceDeckList,
  simulateOpeningHandsTool,
  updateDeck,
} from "./tools/decks";
import {
  budgetReplacementsTool,
  checkOwnedTool,
  findCombosForDeckTool,
  getAccount,
  getCard,
  getRulingsTool,
  lookupRulesTool,
  semanticSearchForDeckTool,
  similarCardsTool,
} from "./tools/library";
import { analyzeCards, getSearchGuide, searchCards, searchForDeckTool } from "./tools/search";
import { addWish, getWishlist, removeWish } from "./tools/wishlist";

// The tool registry (design doc 28, section 3.2): every LLM tool, once. Both endpoints are built
// from this list, so they always offer the same tools (rule 6).

export const TOOLS: readonly LlmTool[] = [
  getAccount,
  listDecks,
  getDeck,
  simulateOpeningHandsTool,
  auditDeckTool,
  analyzeCards,
  searchForDeckTool,
  searchCards,
  getSearchGuide,
  getCard,
  getRulingsTool,
  lookupRulesTool,
  checkOwnedTool,
  edhrecCommanderTool,
  compareToEdhrecTool,
  similarCardsTool,
  semanticSearchForDeckTool,
  budgetReplacementsTool,
  findCombosForDeckTool,
  planManaBaseTool,
  getWishlist,
  createDeck,
  updateDeck,
  applyChangesTool,
  replaceDeckList,
  goldfishStartTool,
  goldfishStepTool,
  deckSourcesTool,
  addWish,
  removeWish,
];

/** House rules, for MCP's server instructions and OpenAPI's description (rule 10 repeats them). */
export const INSTRUCTIONS = [
  "Proxy Library: self-hosted Magic: The Gathering collection with play money (cents: $1.23 = 123), a store of singles, decks, and a wishlist.",
  "No app tool output is a recommendation. Cite an outside source or the card's rules text for every add or cut you suggest.",
  "Workflow: (1) Read the deck with get_deck and deck_facts. (2) Gather outside evidence (edhrec_commander, compare_to_edhrec, find_combos, get_rulings, lookup_rules, guides) and cite it. (3) Check catalog/ownership/prices with check_owned, search_for_deck, search_cards, get_card, and analyze_cards. (4) Preview changes with apply_changes (save: false) and commit with { deckId, previewId, save: true } (or replace_deck_list with fingerprint). Save research links with deck_sources.",
  "Rules: decks may hold unowned cards (shown as short); prefer owned cards. Move agreed cuts to the \"maybe\" board instead of deleting. Only cards in this catalog exist here, not all of Scryfall. Keep Commander brackets (1-5) within target (-is:gc excludes Game Changers). Nothing here buys or sells; use add_wish for cards to buy later.",
].join("\n");

export function findTool(name: string): LlmTool | undefined {
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
  if (!allows(context.scopes, tool.scope)) {
    return { kind: "problem", problem: { kind: "MissingScope", scope: tool.scope } };
  }
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
  return { kind: "outcome", outcome: await tool.run(context, parsed.data) };
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
