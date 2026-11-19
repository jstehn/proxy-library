import { z } from "zod";
import { lookupRules } from "@/modules/catalog";
import { checkOwnedCards, deckView, findCard, isPlayed, declaredComboFor } from "@/modules/decks";
import { deckProfileFor } from "../avoid-cards";
import { findRuleInteractions, findSharedRules, matchRelatedRules } from "../related-rules";
import { deckNotFound, defineTool, done, failed, moneyOrNull } from "../tool";

// Your account, cards and the app's own recommendations (design doc 28, section 5.2).

const deckId = z.number().int().positive().describe("The deck's id, from list_decks.");

export const getRulingsTool = defineTool({
  name: "get_rulings",
  title: "Get Scryfall rulings for cards",
  description: [
    "Fetches official Scryfall rulings (with dates) for one or more cards, cached server-side for 24 hours.",
    "Use it when: checking rules interactions (e.g., alternative costs, replacement effects, triggered abilities) before recommending or cutting a card.",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({
    cards: z
      .array(z.string().min(1))
      .min(1)
      .max(25)
      .describe(
        "Card names or ids to fetch Scryfall rulings for (pass a 1-element array for a single card).",
      ),
  }),
  async run(context, input) {
    const results = await Promise.all(
      input.cards.map(async (query) => {
        const found = await findCard(context.container.db, query);
        try {
          const fetched = await context.container.outsideData.fetchScryfallRulings(
            found ? { name: found.name, scryfallId: found.scryfallId } : { name: query },
          );
          if (fetched === null) {
            return { query, found: false, rulings: [] };
          }
          return {
            query,
            found: true,
            name: fetched.name,
            sourceUrl: fetched.sourceUrl,
            fetchedAt: fetched.fetchedAt,
            cached: fetched.cached,
            rulings: fetched.rulings,
            ...(found ? { relatedRules: matchRelatedRules(found.text) } : {}),
          };
        } catch (error) {
          return {
            query,
            found: false,
            error: error instanceof Error ? error.message : "Failed to fetch rulings.",
            rulings: [],
          };
        }
      }),
    );
    return done({ cards: results });
  },
});

export const checkInteractionTool = defineTool({
  name: "check_interaction",
  title: "Check rules & CR overlap between cards",
  description: [
    "Returns each card's Scryfall rulings plus the Comprehensive Rules sections their oracle texts share (e.g. CR 513 end step, CR 118.9 alternative costs, CR 400.7 zone changes). Lookup only, not a verdict.",
    "Use it when: checking how 2+ cards interact (e.g. Bolas's Citadel + blitz, Mortuary + Avacyn) before recommending them.",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({
    cards: z
      .array(z.string().min(1))
      .min(2)
      .max(10)
      .describe("2 to 10 card names or ids to check for rulings and shared CR sections."),
  }),
  async run(context, input) {
    const resolved = await Promise.all(
      input.cards.map(async (query) => {
        const found = await findCard(context.container.db, query);
        const relatedRules = found ? matchRelatedRules(found.text) : [];
        let rulings: unknown[] = [];
        try {
          const fetched = await context.container.outsideData.fetchScryfallRulings(
            found ? { name: found.name, scryfallId: found.scryfallId } : { name: query },
          );
          if (fetched) rulings = [...fetched.rulings];
        } catch {
          // Non-fatal: still return relatedRules even if Scryfall rulings are unreachable.
        }
        return {
          query,
          found: found !== null,
          name: found?.name ?? query,
          relatedRules,
          rulings,
        };
      }),
    );
    const sharedRules = findSharedRules(resolved);
    const ruleInteractions = findRuleInteractions(resolved);
    return done({
      cards: resolved,
      sharedRules,
      ruleInteractions,
    });
  },
});

const SPELLBOOK_BRACKET_LEGEND = {
  E: "Exhibition (casual / low power)",
  P: "Precon / Core",
  O: "Optimized / Upgraded",
  S: "Strong / High Power",
  R: "Ruthless / Fringe cEDH",
  C: "cEDH",
} as const;

export const findCombosForDeckTool = defineTool({
  name: "find_combos",
  title: "Find N-card combos via Commander Spellbook",
  description: [
    "Queries Commander Spellbook's find-my-combos API (including N-card and commander combos, cached 24 hours) for combos in the deck (distinguishing main-deck `complete` vs `needsMaybe`) and combos 1 card away (`oneAway`).",
    "Use it when: checking what combos a deck runs for bracket disclosure, or finding combo lines and missing pieces.",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({
    deckId,
    includeMaybe: z
      .boolean()
      .default(false)
      .describe("Include cards on the maybeboard when checking for combos."),
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
  async run(context, input) {
    const view = await deckView(context.container.db, context.actor.userId, input.deckId);
    if (view === null) return deckNotFound(input.deckId);

    const commanders = view.lines.filter((l) => l.board === "commander").map((l) => l.name);
    const mainSet = new Set(
      view.lines
        .filter((l) => l.board === "commander" || isPlayed(l.board))
        .map((l) => l.name.toLowerCase()),
    );
    const maybeSet = new Set(
      view.lines.filter((l) => l.board === "maybe").map((l) => l.name.toLowerCase()),
    );
    const mainCards = view.lines
      .filter(
        (l) =>
          l.board !== "commander" &&
          (isPlayed(l.board) || (input.includeMaybe && l.board === "maybe")),
      )
      .map((l) => l.name);

    let spellbook;
    try {
      spellbook = await context.container.outsideData.fetchSpellbookCombos(mainCards, commanders);
    } catch (error) {
      return failed(
        "SpellbookUnavailable",
        `Could not reach Commander Spellbook: ${error instanceof Error ? error.message : "unknown error"}.`,
      );
    }

    const bracketFilter = input.bracket?.toUpperCase();
    const matchesBracket = (tag: string | null | undefined) =>
      !bracketFilter || (tag ?? "").toUpperCase() === bracketFilter;

    const declaredCombos = (await deckProfileFor(context, input.deckId))?.declaredCombos ?? [];
    const classifiedComplete = spellbook.complete
      .filter((c) => matchesBracket(c.bracketTag))
      .map((combo) => {
        const maybePieces = combo.uses.filter(
          (name) => !mainSet.has(name.toLowerCase()) && maybeSet.has(name.toLowerCase()),
        );
        const declared = declaredComboFor(combo, declaredCombos);
        return {
          ...combo,
          status: maybePieces.length > 0 ? ("needsMaybe" as const) : ("complete" as const),
          ...(maybePieces.length > 0 ? { maybePieces } : {}),
          ...(declared !== null ? { declared } : {}),
        };
      });
    const foundDeclarations = new Set(
      classifiedComplete.flatMap((combo) => ("declared" in combo ? [combo.declared] : [])),
    );

    const filteredOneAway = spellbook.oneCardAway.filter((c) => matchesBracket(c.bracketTag));
    const pagedComplete = classifiedComplete.slice(input.offset, input.offset + input.limit);
    const pagedOneAway = filteredOneAway.slice(input.offset, input.offset + input.limit);

    const missingNames = [...new Set(pagedOneAway.map((c) => c.missingCardName))];
    const ownedChecks =
      missingNames.length > 0
        ? await checkOwnedCards(context.container.db, context.actor.userId, missingNames)
        : [];
    const checkByQuery = new Map(ownedChecks.map((c) => [c.query.toLowerCase(), c]));

    const mainCompleteCount = classifiedComplete.filter((c) => c.status === "complete").length;
    const needsMaybeCount = classifiedComplete.filter((c) => c.status === "needsMaybe").length;

    return done({
      sourceUrl: spellbook.sourceUrl,
      fetchedAt: spellbook.fetchedAt,
      cached: spellbook.cached,
      bracketLegend: SPELLBOOK_BRACKET_LEGEND,
      totalComplete: mainCompleteCount,
      totalNeedsMaybe: needsMaybeCount,
      ...(declaredCombos.length > 0
        ? {
            declaredCombos: declaredCombos.map((declared) => ({
              declared,
              foundBySpellbook: foundDeclarations.has(declared),
            })),
            undeclaredComplete: classifiedComplete.filter(
              (combo) => combo.status === "complete" && !("declared" in combo),
            ).length,
          }
        : {}),
      totalOneAway: filteredOneAway.length,
      offset: input.offset,
      limit: input.limit,
      complete: pagedComplete,
      oneCardAway: pagedOneAway.map((combo) => {
        const owned = checkByQuery.get(combo.missingCardName.toLowerCase());
        return {
          id: combo.id,
          status: "oneAway" as const,
          missingPiece:
            owned && owned.inCatalog
              ? {
                  name: owned.name,
                  inCatalog: true,
                  owned: owned.ownedTotal > 0,
                  ownedTotal: owned.ownedTotal,
                  cheapestPrice: moneyOrNull(owned.cheapestPriceCents),
                }
              : {
                  name: combo.missingCardName,
                  inCatalog: false,
                  owned: false,
                  ownedTotal: 0,
                  cheapestPrice: null,
                },
          uses: combo.uses,
          produces: combo.produces,
          steps: combo.steps,
          prerequisites: combo.prerequisites,
          bracketTag: combo.bracketTag,
          manaNeeded: combo.manaNeeded,
          identity: combo.identity,
        };
      }),
    });
  },
});

export const lookupRulesTool = defineTool({
  name: "lookup_rules",
  title: "Look up Magic Comprehensive Rules",
  description: [
    "Searches the official Magic: The Gathering Comprehensive Rules by exact rule number (e.g. '702.19a', '103.5c') or hybrid keyword + semantic search (e.g. 'layers', 'commander tax', 'trample deathtouch').",
    "Returns top-ranked verbatim CR excerpts, NOT an exhaustive rules engine: always follow cross-referenced rule numbers (e.g. 'see rule 613.1') and check card-specific rulings with get_rulings before giving a definitive ruling.",
    "Use it when: verifying an exact rules interaction, timing, or keyword definition.",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({
    query: z
      .string()
      .min(1)
      .max(200)
      .describe("Rule number (e.g. '702.19a') or rules question/keywords."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(8)
      .describe("Maximum number of matching rules to return (1 to 20)."),
  }),
  async run(context, input) {
    const result = await lookupRules(context.container.db, context.container.textEmbedder, {
      query: input.query,
      limit: input.limit,
    });
    return done({
      crVersion: result.crVersion,
      note:
        result.crVersion === null
          ? "Comprehensive Rules have not been synced yet (run `pnpm worker sync-rules`). An empty result does not mean no rule exists."
          : "Top-ranked verbatim CR excerpts (not exhaustive). Follow any cross-referenced rule numbers and check get_rulings for card-specific rulings.",
      hits: result.hits,
    });
  },
});
