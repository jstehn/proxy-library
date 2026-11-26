import { z } from "zod";
import type { DeckCombos, SpellbookUnavailable } from "@/modules/decks";
import { defineBinding } from "../binding";
import { moneyOrNull, type ToolError } from "../tool";

const SPELLBOOK_BRACKET_LEGEND = {
  E: "Exhibition (casual / low power)",
  P: "Precon / Core",
  O: "Optimized / Upgraded",
  S: "Strong / High Power",
  R: "Ruthless / Fringe cEDH",
  C: "cEDH",
} as const;

type Failure = Readonly<{ kind: "DeckNotFound" }> | SpellbookUnavailable;

export const findCombosBinding = defineBinding({
  name: "find_combos",
  title: "Find N-card combos via Commander Spellbook",
  description: [
    "Queries Commander Spellbook's find-my-combos API (including N-card and commander combos, cached 24 hours) for combos in the deck (distinguishing main-deck `complete` vs `needsMaybe`) and combos 1 card away (`oneAway`).",
    "Use it when: checking what combos a deck runs for bracket disclosure, or finding combo lines and missing pieces.",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({
    deckId: z.number().int().positive().describe("The deck's id, from list_decks."),
    includeMaybe: z
      .boolean()
      .default(false)
      .describe("Include cards on the maybeboard when checking for combos."),
    ownedOnly: z
      .boolean()
      .default(false)
      .describe(
        "Only return one-card-away combos whose missing piece you already own (owned pieces are always sorted first).",
      ),
    bracket: z
      .enum(["E", "P", "O", "S", "R", "C"])
      .optional()
      .describe("Optional Spellbook bracket letter filter (E, P, O, S, R, C)."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe("Max combos to return per status list (default 20, max 100)."),
    offset: z.number().int().min(0).default(0).describe("Pagination offset into the combo lists."),
  }),
  call: (capabilities, actor, input) =>
    capabilities.deckCombos.combosForDeck({
      userId: actor.userId,
      deckId: input.deckId,
      includeMaybe: input.includeMaybe,
      ownedOnly: input.ownedOnly,
      bracket: input.bracket,
      limit: input.limit,
      offset: input.offset,
    }),
  present(combos: DeckCombos) {
    return {
      sourceUrl: combos.source.sourceUrl,
      fetchedAt: combos.source.fetchedAt,
      cached: combos.source.cached,
      bracketLegend: SPELLBOOK_BRACKET_LEGEND,
      totalComplete: combos.totalComplete,
      totalNeedsMaybe: combos.totalNeedsMaybe,
      ...(combos.declaredCombos.length > 0
        ? {
            declaredCombos: combos.declarations,
            undeclaredComplete: combos.undeclaredComplete,
          }
        : {}),
      totalOneAway: combos.totalOneAway,
      offset: combos.offset,
      limit: combos.limit,
      complete: combos.complete,
      oneCardAway: combos.oneAway.map((combo) => ({
        id: combo.id,
        status: "oneAway" as const,
        ...(combo.maybePieces !== undefined ? { maybePieces: combo.maybePieces } : {}),
        missingPiece: {
          name: combo.missingPiece.name,
          inCatalog: combo.missingPiece.inCatalog,
          owned: combo.missingPiece.owned,
          ownedTotal: combo.missingPiece.ownedTotal,
          cheapestPrice: moneyOrNull(combo.missingPiece.cheapestPriceCents),
        },
        uses: combo.uses,
        produces: combo.produces,
        steps: combo.steps,
        prerequisites: combo.prerequisites,
        bracketTag: combo.bracketTag,
        manaNeeded: combo.manaNeeded,
        identity: combo.identity,
      })),
    };
  },
  describeError(failure: Failure, { input }): ToolError {
    if (failure.kind === "DeckNotFound") {
      return {
        kind: "DeckNotFound",
        message: `Deck ${input.deckId} isn't one of your decks. Call list_decks to see their ids.`,
      };
    }
    return {
      kind: "SpellbookUnavailable",
      message: `Could not reach Commander Spellbook: ${failure.reason}.`,
    };
  },
});
