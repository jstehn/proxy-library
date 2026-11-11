import { z } from "zod";
import { allows, type Scope } from "@/modules/accounts";
import type { LlmTool, ToolContext, ToolOutcome } from "./tool";
import {
  choosePrinting,
  createDeck,
  getDeck,
  listDecks,
  rankCutsTool,
  replaceDeckList,
  setDeckEntry,
  updateDeck,
} from "./tools/decks";
import {
  budgetUpgrades,
  cardsToGet,
  getAccount,
  getCard,
  listSets,
  similarCardsTool,
  suggestForDeck,
} from "./tools/library";
import { analyzeCards, getSearchGuide, searchCards, searchForDeckTool } from "./tools/search";
import { addWish, getWishlist, removeWish, updateWish } from "./tools/wishlist";

// The tool registry (design doc 28, section 3.2): every LLM tool, once. Both endpoints are built
// from this list, so they always offer the same tools (rule 6).

export const TOOLS: readonly LlmTool[] = [
  getAccount,
  listDecks,
  getDeck,
  analyzeCards,
  searchForDeckTool,
  searchCards,
  getSearchGuide,
  getCard,
  suggestForDeck,
  rankCutsTool,
  similarCardsTool,
  budgetUpgrades,
  cardsToGet,
  getWishlist,
  listSets,
  createDeck,
  updateDeck,
  setDeckEntry,
  replaceDeckList,
  choosePrinting,
  addWish,
  updateWish,
  removeWish,
];

/** House rules, for MCP's server instructions and OpenAPI's description (rule 10 repeats them). */
export const INSTRUCTIONS = [
  "Proxy Library: a self-hosted Magic: The Gathering collection with play money, a store of singles, decks and a wishlist. These tools act as the signed-in player.",
  'Building or improving a deck: get_deck (read the commander), analyze_cards (what the deck keeps doing), then search_for_deck with one query per synergy (enablers and payoffs), then judge the cards by their text, then set_deck_entry or replace_deck_list. suggest_for_deck is a second opinion. For ideas on what to cut, rank_cuts lists the cards that score lowest on simple checks, with reasons; set cuts the player agrees to aside on the "maybe" board (the maybeboard, counted nowhere) rather than deleting them.',
  "Commander brackets: get_deck's bracket gives the deck's target bracket (1–5, chosen by the player) and the lowest bracket its cards allow, with the cards that decide it. If a Commander deck has no target, ask the player which bracket they want and save it with update_deck. Keep Game Changers, mass land denial and extra turns within the target (-is:gc leaves Game Changers out of a search); the suggestion and search tools already leave out cards over it. Two-card combos aren't checked: point out any you add.",
  "Rules: decks may hold cards the player doesn't own (they show as short); prefer owned cards. Money is in cents ($1.23 is 123). Always call get_deck before replace_deck_list and pass its fingerprint. Nothing here buys or sells: suggest purchases, or add them to the wishlist with add_wish.",
  "The app's suggestions, possible cuts and budget picks come from simple rules over rules text and prices: treat them as ideas to weigh, not answers, check them against the cards' text, and present them to the player as options.",
  "Only cards in this app's catalog exist here (expansion, core and Commander sets), not all of Scryfall.",
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
