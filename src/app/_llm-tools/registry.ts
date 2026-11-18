import { z } from "zod";
import { allows, type Scope } from "@/modules/accounts";
import type { LlmTool, ToolContext, ToolOutcome } from "./tool";
import {
  applyChangesTool,
  auditDeckTool,
  choosePrinting,
  createDeck,
  diffDeckTool,
  draftDeckTool,
  getDeck,
  listDecks,
  arrangeHeadings,
  planManaBaseTool,
  commandersICanBuildTool,
  deckSnapshotsTool,
  deckTokensTool,
  openingHandOddsTool,
  optimizeDeckTool,
  applyPackageTool,
  createPackageTool,
  deckScorecardTool,
  listPackagesTool,
  mulliganDrillTool,
  replaceDeckList,
  setDeckEntry,
  simulateOpeningHandsTool,
  snapshotDeckTool,
  updateDeck,
  upgradeRoadmapTool,
} from "./tools/decks";
import {
  budgetReplacementsTool,
  budgetUpgrades,
  cardsToGet,
  findCombosForDeckTool,
  getAccount,
  getCard,
  listSets,
  semanticSearchForDeckTool,
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
  deckTokensTool,
  openingHandOddsTool,
  simulateOpeningHandsTool,
  auditDeckTool,
  analyzeCards,
  searchForDeckTool,
  searchCards,
  getSearchGuide,
  getCard,
  suggestForDeck,
  optimizeDeckTool,
  planManaBaseTool,
  draftDeckTool,
  commandersICanBuildTool,
  similarCardsTool,
  semanticSearchForDeckTool,
  findCombosForDeckTool,
  budgetUpgrades,
  budgetReplacementsTool,
  upgradeRoadmapTool,
  cardsToGet,
  getWishlist,
  listSets,
  createDeck,
  updateDeck,
  setDeckEntry,
  applyChangesTool,
  arrangeHeadings,
  replaceDeckList,
  choosePrinting,
  deckSnapshotsTool,
  diffDeckTool,
  deckScorecardTool,
  mulliganDrillTool,
  snapshotDeckTool,
  listPackagesTool,
  createPackageTool,
  applyPackageTool,
  addWish,
  updateWish,
  removeWish,
];

/** House rules, for MCP's server instructions and OpenAPI's description (rule 10 repeats them). */
export const INSTRUCTIONS = [
  "Proxy Library: a self-hosted Magic: The Gathering collection with play money, a store of singles, decks and a wishlist. These tools act as the signed-in player.",
  "No app tool output is a recommendation. Cite an outside source or the card's rules text for every add or cut you suggest.",
  "Research-first workflow for building or improving a deck: (1) Read the deck with get_deck (read the commander's and cards' oracle text) and deck_facts (legality, bracket, role counts, curve, ownership). (2) Gather outside evidence (EDHREC, deckbuilding guides/primers, Commander Spellbook, Scryfall rulings) and cite it. (3) Use app tools (search_for_deck, search_cards, get_card, analyze_cards) to check catalog availability, ownership, prices, and rules text, then apply agreed changes with apply_changes, set_deck_entry, or replace_deck_list. No commander yet? commanders_i_can_build surfaces legends your collection covers; read their oracle text and research outside sources before choosing, then create_deck. Once spells are chosen, plan_mana_base proposes a starting land skeleton (owned first, then basics). To set agreed cuts aside, move them to the \"maybe\" board rather than deleting them. A deck may use headings of the player's own (\"Ramp\"): see get_deck's headings; set them with set_deck_entry and arrange_headings.",
  "Commander brackets: get_deck's bracket gives the deck's target bracket (1–5, chosen by the player) and the lowest bracket its cards allow, with the cards that decide it. If a Commander deck has no target, ask the player which bracket they want and save it with update_deck. Keep Game Changers, mass land denial and extra turns within the target (-is:gc leaves Game Changers out of a search); the search and idea tools already leave out cards over it. Two-card combos aren't checked: point out any you add.",
  "Rules: decks may hold cards the player doesn't own (they show as short); prefer owned cards. Money is in cents ($1.23 is 123). Preview multi-card swaps with apply_changes (save: false) before saving, and always pass its fingerprint to apply_changes (save: true) or replace_deck_list. Nothing here buys or sells: suggest purchases, or add them to the wishlist with add_wish.",
  "CRITICAL — Heuristic and idea tools are NOT recommendations or finished decks: draft_deck, plan_mana_base, commanders_i_can_build, idea_candidates, idea_budget_upgrades, idea_budget_replacements, idea_optimize_deck, idea_upgrade_roadmap, and deck_facts scores use simple regex tags and mana-cost buckets without understanding how cards actually work together. Treat their output strictly as low-reliability raw ideas or starting skeletons (never as verdicts): verify every card against its oracle text (get_deck / get_card) and outside sources (EDHREC, Spellbook, rulings) before suggesting it.",
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
