import { randomUUID } from "node:crypto";
import { z } from "zod";
import { PrintingId } from "@/modules/catalog";

const EDHREC_FRAMING =
  "Popularity data: shows what people play, not what is good. Inclusion % is not win rate.";
import {
  addDeckSource,
  auditDeck,
  BOARDS,
  bracketLine,
  bracketRuleReasons,
  COMMANDER_SORTS,
  commanderDetails,
  commandersICanBuild,
  combosForDeck,
  dealMulliganDrill,
  deckScorecard,
  bracketWarning,
  chanceByTurn,
  checkNote,
  checkOwnedCards,
  compareDeckSnapshot,
  CORE_DECK_TAGS,
  deckChangePreview,
  deckProblems,
  deckStats,
  deckText,
  deckTokenLines,
  deckUpgradeRoadmap,
  deckView,
  DeckId,
  draftForDeck,
  EARLY_RAMP_MAX_MV,
  estimateBracket,
  decksFor,
  filterTokenChecklist,
  findCard,
  fingerprint,
  formatRulesSummary,
  FORMATS,
  getDeckProfile,
  GROUPINGS,
  isPlayed,
  legalFormatsForCards,
  library,
  resolveDeckProfileTargets,
  summarizeDeckProfile,
  primerSections,
  updateDeckPrimer,
  updateDeckProfile,
  effectiveManaValue,
  type DeckPlanProfile,
  isAvoidCard,
  isKeyCard,
  listCardPackages,
  listDeckSnapshots,
  listDeckSources,
  applyCardPackageToDeck,
  createCardPackage,
  manaBasePlan,
  MAX_HEADING_LENGTH,
  MAX_HEADINGS,
  MAX_NOTE_LENGTH,
  MAX_ROLE_LENGTH,
  MAX_QUANTITY,
  MAX_SNAPSHOT_LABEL_LENGTH,
  MAX_SNAPSHOTS_PER_DECK,
  openingHandOdds,
  optimizeDeckForView,
  roleTargets,
  SnapshotId,
  SPELL_SLOTS,
  shortList,
  simulateOpeningHands,
  summarizeTokenChecklist,
  TOKEN_KINDS,
  toTokenChecklistItem,
  type CommanderCoverage,
  type DeckChange,
  type DeckChangePreview,
  type DeckCombo,
  type DeckProblem,
  type DeckLine,
  type DeckView,
  type GoldfishAction,
  type GoldfishCard,
  type GoldfishState,
  type GoldfishStepInput,
  type SnapshotComparison,
  colorPips,
  type GoldfishSessionError,
  type MustCastByOption,
} from "@/modules/decks";
import { canonicalTheme, cardTags, TAGS, THEMES } from "@/shared/card-search";
import { deckProfileFor } from "../avoid-cards";
import { MAX_TOOL_RESPONSE_BYTES } from "../cap-response";
import { groupCompactLines, pageCompactGroups } from "../compact-deck";
import { seededRng } from "@/shared/kernel";
import {
  bracketWarningText,
  draftReasonText,
  estimateLabel,
  findingWithCards,
  landReasonText,
  landTargetReasonText,
  planText,
  problemText,
  reasonText,
  TAG_LABELS,
  uncheckedText,
} from "@/app/decks/labels";
import {
  cardNotFound,
  deckNotFound,
  defineTool,
  done,
  failed,
  heuristicProvenance,
  money,
  moneyOrNull,
  type ToolContext,
} from "../tool";
import { assertNever } from "@/shared/kernel";

// Reading and editing decks (design doc 28, section 5.2). Edits go through the decks module's
// use cases with the token's Actor, so they follow the same rules as the deck builder.

const deckId = z.number().int().positive().describe("The deck's id, from list_decks.");
const board = z
  .enum(BOARDS)
  .default("main")
  .describe(
    'Which part of the deck: "main", "side" (sideboard), "commander", or "maybe" (the maybeboard: cards being considered, counted nowhere).',
  );
/** What a heading refusal says (design doc 34), shared by set_deck_entry and arrange_headings. */
const HEADING_RULE = `A heading starts with a letter, has at most ${MAX_HEADING_LENGTH} characters, and isn't a board or card type name ("Sideboard", "Creatures"). A deck has at most ${MAX_HEADINGS}.`;

const card = z
  .string()
  .min(1)
  .describe("The card's exact English name (a double-faced card's front name works), or its id.");

/** The deck as the edit tools need it: its list text and the fingerprint of what's stored. */
function listAndFingerprint(view: DeckView): { list: string; fingerprint: string } {
  const list = deckText(
    view.lines.map((line) => ({
      quantity: line.quantity,
      name: line.name,
      board: line.board,
      setCode: line.pinnedPrintingId === null ? null : line.setCode,
      collectorNumber: line.pinnedPrintingId === null ? null : line.collectorNumber,
      finish: line.pinnedFinish,
      heading: line.heading,
    })),
    // Grouped by its own headings, the list shows them as "Ramp (9)" blocks (design doc 34).
    view.deck.grouping === "custom" ? view.deck.headings : null,
  );
  const print = fingerprint(
    view.lines.map((line) => ({
      ...line,
      printingId: line.pinnedPrintingId,
      finish: line.pinnedFinish,
    })),
  );
  return { list, fingerprint: print };
}

function problemsOf(view: DeckView): DeckProblem[] {
  const owned = new Map(view.lines.map((line) => [line.oracleId, line.owned]));
  return deckProblems(
    view.deck,
    (oracleId) => view.rules[oracleId],
    (oracleId) => owned.get(oracleId) ?? 0,
  );
}

/** The bracket estimate and target, as get_deck reports them (design doc 31). Null outside Commander. */
function bracketOf(view: DeckView, combos?: readonly DeckCombo[]) {
  const estimate = estimateBracket(view.deck.format, view.lines.map(bracketLine), { combos });
  if (estimate === null) return null;
  const warning = bracketWarning(estimate, view.deck.targetBracket);
  const reasons = bracketRuleReasons(estimate.findings);
  return {
    target: view.deck.targetBracket,
    floor: estimate.floor,
    range: estimate.range,
    summary: `${estimateLabel(estimate)} (at least, from the cards)`,
    gameChangers: estimate.gameChangers,
    findings: estimate.findings.map((finding, idx) => ({
      rule: finding.rule,
      count: finding.count,
      forces: finding.forces,
      threshold: reasons[idx]?.threshold,
      cards: finding.cards,
      text: findingWithCards(finding),
    })),
    overTarget: warning === null ? null : bracketWarningText(warning),
    unchecked: uncheckedText(estimate.unchecked),
  };
}

async function viewFor(context: ToolContext, id: number) {
  return deckView(context.container.db, context.actor.userId, id);
}

export const optimizeDeckTool = defineTool({
  name: "idea_optimize_deck",
  title: "Multi-card swap ideas via Simulated Annealing",
  description: [
    "Runs a Simulated Annealing local search over the deck's non-land mainboard slots using regex role/theme heuristics to surface multi-card swap ideas (sorted alphabetically by cut card, no per-card verdict). Raw heuristic ideas to verify against card text and outside sources, not recommendations.",
    "Use it when: the player asks for heuristic multi-card swap ideas rather than researching one card at a time.",
    "Rules: read-only preview — does not mutate the deck; preview/apply accepted swaps with apply_changes.",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({
    deckId,
    pool: z
      .enum(["owned", "store", "both"])
      .default("owned")
      .describe("Candidate pool to search from: owned cards, store cards, or both."),
    maxSwaps: z
      .number()
      .int()
      .min(1)
      .max(15)
      .default(5)
      .describe("Maximum number of simultaneous swaps to propose (1 to 15)."),
    maxAddedPriceCents: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Optional budget ceiling in cents for total price of added cards."),
    iterations: z
      .number()
      .int()
      .min(50)
      .max(1000)
      .default(350)
      .describe("Simulated Annealing iterations to run (50 to 1000)."),
    seed: z
      .string()
      .max(64)
      .optional()
      .describe("Optional deterministic RNG seed for reproducible runs."),
  }),
  async run(context, input) {
    const outcome = await optimizeDeckForView(
      context.container.db,
      context.actor.userId,
      input.deckId,
      {
        pool: input.pool,
        maxSwaps: input.maxSwaps,
        maxAddedPriceCents: input.maxAddedPriceCents ?? null,
        iterations: input.iterations,
        seed: input.seed,
      },
    );
    if (outcome === null) return deckNotFound(input.deckId);

    const { deck, result } = outcome;
    return done({
      provenance: heuristicProvenance("simulated annealing over regex heuristic", [
        "card text",
        "edhrec",
      ]),
      deck: {
        id: deck.id,
        name: deck.name,
        format: deck.format,
        targetBracket: deck.targetBracket,
      },
      heuristicBefore: result.before,
      heuristicAfter: result.after,
      heuristicDelta: result.delta,
      iterationsRun: result.iterationsRun,
      acceptedMoves: result.acceptedMoves,
      improvedMoves: result.improvedMoves,
      swaps: result.swaps
        .map((s) => ({
          cut: { name: s.cut.name, oracleId: s.cut.oracleId, manaValue: s.cut.manaValue },
          add: {
            name: s.add.name,
            oracleId: s.add.oracleId,
            manaValue: s.add.manaValue,
            pool: s.add.pool ?? "owned",
            priceCents: s.priceCents,
          },
        }))
        .sort((a, b) => a.cut.name.localeCompare(b.cut.name)),
    });
  },
});

export const planManaBaseTool = defineTool({
  name: "mana_base_skeleton",
  title: "Starting mana base skeleton",
  description: [
    "Returns a rough starting land skeleton (not a finished mana base): target land count, color source targets vs. current, owned lands first then basics, plus up to 5 store lands to consider.",
    "Use it when: drafting an initial land count/mana skeleton after spells are chosen; verify lands against card text and EDHREC.",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({ deckId }),
  async run(context, input) {
    const plan = await manaBasePlan(context.container.db, context.actor.userId, input.deckId);
    if (plan === null) return deckNotFound(input.deckId);
    const describeLand = (land: (typeof plan.add)[number]) => ({
      name: land.card.name,
      quantity: land.quantity,
      kind: land.card.isBasicLand ? "basic" : land.card.priceCents === null ? "owned" : "store",
      tapped: land.tapped,
      why: land.reasons.map(landReasonText),
      alsoIn: land.card.alsoIn,
    });
    return done({
      provenance: heuristicProvenance("mana-curve & pip-share heuristic", ["card text", "edhrec"]),
      outputKind: "skeleton",
      lands: plan.lands,
      landTarget: plan.landTarget.lands,
      landTargetWhy: plan.landTarget.reasons.map(landTargetReasonText),
      over: plan.over,
      sources: plan.sources.map((source) => ({
        color: source.color,
        have: source.have,
        target: source.target,
        mostOfItInOneCost: source.heaviestCost,
      })),
      add: plan.add.map(describeLand),
      considerBuying: plan.considerBuying.map((land) => ({
        ...describeLand(land),
        price: moneyOrNull(land.card.priceCents),
      })),
      castability: {
        averageBeforePct: Math.round(plan.castability.before.averageCastOnCurvePct * 100),
        averageAfterPct: Math.round(plan.castability.after.averageCastOnCurvePct * 100),
        strugglingBefore: plan.castability.before.struggling.slice(0, 8).map((s) => ({
          name: s.name,
          manaCost: s.manaCost,
          castOnCurvePct: Math.round(s.castOnCurvePct * 100),
          bottleneckColor: s.bottleneckColor,
        })),
        strugglingAfter: plan.castability.after.struggling.slice(0, 8).map((s) => ({
          name: s.name,
          manaCost: s.manaCost,
          castOnCurvePct: Math.round(s.castOnCurvePct * 100),
          bottleneckColor: s.bottleneckColor,
        })),
      },
    });
  },
});

export const draftDeckTool = defineTool({
  name: "draft_deck",
  title: "Draft a rough heuristic starting point from owned cards",
  description: [
    "Assembles a coarse heuristic starting skeleton for a constructed or casual deck (100-card Commander with a commander, or 60-card formats like Standard/Pioneer/Modern/Legacy/Vintage/Pauper/Casual with up to 4-of playsets): fills open slots from the player's owned cards first (every copy they own counts, even ones in other decks, with a note in alsoIn), starting with missing role targets (ramp, draw, removal, wipe), then spells matching the deck's regex theme tags, tribes and keywords, then generic on-color mana-curve filler; if owned cards can't finish a role or reach the spell count and includeStore is 'fill-gaps', fills the remaining gaps from the store with prices and a storeCost total; finally calls plan_mana_base on the drafted curve to add owned non-basic lands and basics to reach the deck's target size (100 Commander, 60 constructed/casual).",
    "Use it when: you want a fast initial survey of what the player's collection can contribute toward a deck (and what roles are still missing). WARNING: This tool is a blind tag-and-curve heuristic that does NOT understand how cards actually work together. Filling or creating a deck directly from this tool without further work will produce an AWFUL, unfocused deck (especially 'curve' section picks, which are merely random on-color cards that plug a mana cost).",
    "Rules: treat this strictly as a starting point that requires additional investigation. Read the commander's and candidates' oracle text (get_deck), run analyze_cards and search_for_deck to find real enablers, payoffs and win conditions, replace weak matches and curve filler, and make sure the player knows this raw draft is only a rough starting skeleton before applying agreed cards with replace_deck_list or set_deck_entry.",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({
    deckId,
    themes: z
      .array(z.enum(THEMES))
      .default([])
      .describe('Optional extra themes to lean into, e.g. ["tokens", "sacrifice"].'),
    roleTargets: z
      .object({
        ramp: z
          .number()
          .int()
          .min(0)
          .max(30)
          .optional()
          .describe("Target ramp count (defaults: Commander 10, 60-card 4)."),
        draw: z
          .number()
          .int()
          .min(0)
          .max(30)
          .optional()
          .describe("Target card draw count (defaults: Commander 10, 60-card 6)."),
        removal: z
          .number()
          .int()
          .min(0)
          .max(30)
          .optional()
          .describe("Target single-target removal count (defaults: Commander 8, 60-card 6)."),
        wipe: z
          .number()
          .int()
          .min(0)
          .max(30)
          .optional()
          .describe("Target board wipe count (defaults: Commander 3, 60-card 2)."),
      })
      .optional()
      .describe(
        "Optional overrides for role targets (defaults: Commander ramp 10/draw 10/removal 8/wipe 3; 60-card ramp 4/draw 6/removal 6/wipe 2).",
      ),
    includeStore: z
      .enum(["fill-gaps", "none"])
      .default("fill-gaps")
      .describe(
        '"fill-gaps" uses owned cards first and fills unmet role targets or empty spell slots from the store with prices; "none" uses only owned cards.',
      ),
  }),
  async run(context, input) {
    const view = await viewFor(context, input.deckId);
    if (view === null) return deckNotFound(input.deckId);
    if (view.deck.format === "limited") {
      return failed("LimitedDeck", "draft_deck only drafts constructed or casual decks.");
    }
    if (
      view.deck.format === "commander" &&
      !view.lines.some((line) => line.board === "commander")
    ) {
      return failed(
        "CommanderMissing",
        "Put a commander on the commander board first before calling draft_deck.",
      );
    }
    const draft = await draftForDeck(context.container.db, context.actor.userId, input.deckId, {
      themes: input.themes,
      roleTargets: input.roleTargets,
      includeStore: input.includeStore,
    });
    if (draft === null) return deckNotFound(input.deckId);

    return done({
      provenance: heuristicProvenance("regex heuristic + mana-cost buckets", [
        "card text",
        "edhrec",
      ]),
      outputKind: "skeleton",
      deck: { id: view.deck.id, name: view.deck.name, format: view.deck.format },
      existingCount: draft.existingCount,
      totalAfterDraft: draft.totalAfterDraft,
      ownedAddedCount: draft.ownedAddedCount,
      storeAddedCount: draft.storeAddedCount,
      storeCost: money(draft.storeCostCents),
      profile: draft.profile,
      roleSummary: draft.roleSummary,
      spells: draft.spells.map((spell) => ({
        name: spell.name,
        quantity: spell.quantity,
        manaCost: spell.manaCost,
        typeLine: spell.typeLine,
        pool: spell.pool,
        section: spell.section,
        ...(spell.primaryRole !== undefined ? { primaryRole: spell.primaryRole } : {}),
        why: spell.reasons.map(draftReasonText),
        ...(spell.pool === "store" ? { price: moneyOrNull(spell.priceCents) } : {}),
        ...(spell.alsoIn.length > 0 ? { alsoIn: spell.alsoIn } : {}),
      })),
      landsToAdd: draft.manaBase.add.map((land) => ({
        name: land.card.name,
        quantity: land.quantity,
        kind: land.card.isBasicLand ? "basic" : "owned",
        tapped: land.tapped,
        why: land.reasons.map(landReasonText),
        ...(land.card.alsoIn.length > 0 ? { alsoIn: land.card.alsoIn } : {}),
      })),
      note: "WARNING: This draft is a coarse tag-and-curve heuristic, NOT a finished deck. Filling a deck directly from this output without refinement will produce a weak, unfocused deck (especially 'curve' section picks, which only plug a mana cost). Use this as a starting point for investigation: check the cards' oracle text, run analyze_cards and search_for_deck for real enablers and payoffs, replace filler, and tell the player clearly that this is only an initial heuristic skeleton.",
    });
  },
});

const ManaColorSchema = z.enum(["W", "U", "B", "R", "G"]);

export const commandersICanBuildTool = defineTool({
  name: "commanders_i_can_build",
  title: "Find commanders my cards could build",
  description: [
    `Ranks the cards that could lead a Commander deck by how much of a deck the player's own cards already cover ("coverage", default), by Scryfall EDHREC popularity ("popularity"), by a card-strength & Game Changer heuristic ("power"), or by a blend of all three ("combined"): "onPlan" cards (inside its color identity, sharing a theme, creature type or keyword its text cares about), the roles ramp, draw, removal and wipes against the usual targets, how many of a deck's ${SPELL_SLOTS} spell slots their on-color cards could fill, and how many on-color non-basic lands they own. Every copy the player owns counts, even ones in other decks. Filter by "theme" (e.g. "politics", "voting", "treasures", "artifact-tokens", "blink") or "tribe" (e.g. "Elf", "Dragon").`,
    'Use it when: the player wants a new deck but has no commander yet, or asks which legend their collection supports. With "commander" (a name), it returns that one in detail instead: the on-plan cards and why, the cards for each role, and the cheapest store cards that would fill what\'s missing, with a total.',
    "Rules: these rankings are starting-point heuristics over rules text and Scryfall metadata, not tournament win rates or a verdict on the best commander: read the commander's oracle text, present a few options with their trade-offs, and let the player choose. Then create_deck with the list \"Commander\\n1 <name>\" and build it the usual way. Partners and Backgrounds aren't paired here.",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({
    colors: z
      .array(ManaColorSchema)
      .default([])
      .describe('Only commanders whose color identity includes all of these, e.g. ["G", "W"].'),
    theme: z
      .string()
      .optional()
      .describe(
        'Only commanders whose plan leads this theme (or an otag alias), e.g. "politics", "voting", "goad", "treasures", "artifact-tokens", "creature-tokens", "blink", "counters".',
      ),
    tribe: z
      .string()
      .optional()
      .describe(
        'Only commanders whose plan or creature subtypes include this tribe, e.g. "Elf", "Dragon", "Goblin".',
      ),
    sort: z
      .enum(COMMANDER_SORTS)
      .default("coverage")
      .describe(
        'Ordering heuristic: "coverage" (cards owned, default), "combined" (blend of coverage, popularity and power), "popularity" (Scryfall EDHREC rank), or "power" (Game Changer, card strength and plan richness).',
      ),
    includeStore: z
      .boolean()
      .default(false)
      .describe("Also legends the player doesn't own, from the store, with their price."),
    limit: z.number().int().min(1).max(50).default(10).describe("How many to return."),
    commander: z
      .string()
      .optional()
      .describe("A commander's name: return that one in detail instead of the list."),
  }),
  async run(context, input) {
    const { db } = context.container;
    const userId = context.actor.userId;
    if (input.commander !== undefined) {
      const found = await findCard(db, input.commander);
      if (found === null) return cardNotFound(input.commander);
      const details = await commanderDetails(db, userId, found.oracleId);
      if (details === null) {
        return failed("NotACommander", `${found.name} can't lead a Commander deck.`);
      }
      return done({
        provenance: heuristicProvenance("regex heuristic + scryfall metadata", [
          "card text",
          "edhrec",
        ]),
        ...describeCoverage(details.coverage),
        onPlanCards: details.onPlan.map((entry) => ({
          name: entry.card.name,
          why: entry.reasons.map(reasonText),
        })),
        cardsByRole: Object.fromEntries(
          Object.entries(details.byRole).map(([tag, cards]) => [
            tag,
            cards.map((card) => card.name),
          ]),
        ),
        missing: {
          total: money(details.missing.totalCents),
          cards: details.missing.picks.map((pick) => ({
            name: pick.card.name,
            fills: pick.fills === "plan" ? "on-plan" : pick.fills,
            price: moneyOrNull(pick.card.priceCents),
          })),
          note: "The cheapest store cards for the roles still short, then on-plan cards for the empty slots: an estimate, not a shopping list.",
        },
      });
    }
    const resolvedTheme =
      input.theme === undefined || input.theme.trim() === ""
        ? undefined
        : canonicalTheme(input.theme.trim());
    if (input.theme !== undefined && input.theme.trim() !== "" && resolvedTheme === null) {
      return failed(
        "UnknownTheme",
        `Unknown theme "${input.theme}". Known themes: ${THEMES.join(", ")}.`,
      );
    }
    const ranked = await commandersICanBuild(db, userId, {
      colors: input.colors,
      includeStore: input.includeStore,
      theme: resolvedTheme ?? undefined,
      tribe: input.tribe,
      sort: input.sort,
    });
    return done({
      provenance: heuristicProvenance("regex heuristic + scryfall metadata", [
        "card text",
        "edhrec",
      ]),
      found: ranked.length,
      sort: input.sort,
      ...(resolvedTheme ? { theme: resolvedTheme } : {}),
      ...(input.tribe ? { tribe: input.tribe } : {}),
      heuristicNote:
        "These rankings are starting-point heuristics over regex theme tags, collection counts, and Scryfall EDHREC rank — not tournament win rates or a verdict on the best commander. Always read the commander's oracle text and investigate real synergies before building.",
      commanders: ranked.slice(0, input.limit).map(describeCoverage),
    });
  },
});

/** One commander's coverage, as the tool reports it. */
function describeCoverage(coverage: CommanderCoverage) {
  const { commander } = coverage;
  return {
    name: commander.name,
    manaCost: commander.manaCost ?? null,
    typeLine: commander.typeLine,
    text: commander.text,
    colorIdentity: commander.colorIdentity.join("") || "colorless",
    owned: commander.ownedCopies > 0,
    price: moneyOrNull(commander.priceCents),
    isGameChanger: commander.isGameChanger,
    edhrecRank: commander.edhrecRank ?? null,
    leads: planText(coverage.plan) || "nothing these rules read from its text",
    onPlan: coverage.onPlan,
    roles: coverage.roles.map((role) => ({ role: role.tag, have: role.have, target: role.target })),
    spellsFromYourCards: `${coverage.filled} of ${SPELL_SLOTS}`,
    ownedLands: coverage.ownedLands,
    coverageScore: coverage.score,
    powerScore: coverage.powerScore,
    combinedScore: coverage.combinedScore,
    alreadyLeads: commander.leads,
  };
}

export const listDecks = defineTool({
  name: "list_decks",
  title: "List my decks",
  description: [
    "Lists your decks, most recently changed first: id, name, format, card count, and how many cards each is short (copies the deck uses that you don't own).",
    "Use it when: you need a deck's id, or an overview of the decks. Then call get_deck for one deck.",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({}),
  async run(context) {
    const decks = await decksFor(context.container.db, context.actor.userId);
    return done({
      decks: decks.map((deck) => ({
        id: deck.id,
        name: deck.name,
        format: deck.format,
        cards: deck.cards,
        short: deck.short,
        usesRealCards: deck.usesRealCards,
        visibility: deck.visibility,
        updatedAt: deck.updatedAt,
      })),
    });
  },
});

/** Sections get_deck's compact view adds only when asked (design doc 61, section 5a). */
const GET_DECK_INCLUDES = [
  "prices",
  "ids",
  "owners",
  "tokens",
  "odds",
  "sources",
  "legality",
  "list",
  "formatRules",
] as const;

const GetDeckInput = z.object({
  deckId,
  view: z
    .enum(["compact", "full"])
    .default("compact")
    .describe(
      '"compact" (default): each card once as a readable line, grouped by the deck\'s headings. "full": the older object-per-line shape for scripts (uses includeText/includeOtherDecks/fields).',
    ),
  text: z
    .boolean()
    .default(true)
    .describe(
      "Compact view: append each card's oracle text (its own name as ~, reminder text dropped). false gives a shorter list without rules text.",
    ),
  cards: z
    .array(z.string().min(1))
    .min(1)
    .max(30)
    .optional()
    .describe(
      "Return full detail for just these cards in the deck: complete oracle text, ids, price, ownership, other decks, note.",
    ),
  include: z
    .array(z.enum(GET_DECK_INCLUDES))
    .default([])
    .describe(
      'Compact view extras: "prices", "ids" (oracle/printing ids), "owners" (owned, free, other decks), "tokens", "odds" (opening-hand odds), "sources" (saved research links), "legality", "list" (import/export text), "formatRules".',
    ),
  cursor: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      "Compact view: the `next` value from the previous page, when a deck is too big for one.",
    ),
  includeText: z
    .boolean()
    .default(false)
    .describe(
      'view: "full" only. Include each card\'s rules text (off by default; the compact view has its own `text`).',
    ),
  includeOtherDecks: z
    .boolean()
    .default(false)
    .describe(
      'view: "full" only. Include the other decks using each card (the compact view uses include: ["owners"]).',
    ),
  boards: z
    .array(z.enum(BOARDS))
    .optional()
    .describe('Optional board filter for lines (e.g. ["main", "maybe"]).'),
  tag: z.string().min(1).optional().describe('Optional tag filter for lines (e.g. "Blitz").'),
  singleTagOnly: z
    .boolean()
    .default(false)
    .describe("When true, return only non-land lines that have exactly one tag (cohesion check)."),
  fields: z
    .array(
      z.enum([
        "deck",
        "fingerprint",
        "lines",
        "stats",
        "formatRules",
        "cardLegalIn",
        "roleTargets",
        "problems",
        "bracket",
        "openingHandOdds",
        "tokens",
        "list",
        "shortList",
        "toComplete",
        "deckSources",
        "profileSummary",
      ]),
    )
    .optional()
    .describe('view: "full" only. Top-level fields to return (e.g. ["fingerprint", "lines"]).'),
});

type GetDeckInputValue = z.output<typeof GetDeckInput>;

export const getDeck = defineTool({
  name: "get_deck",
  title: "Get a deck",
  description: [
    "Returns a deck as readable lines grouped by its headings: \"qty name · cost · type [P/T] · tags · SHORT n · GC · PINNED · role · note — oracle text\" (the card's own name is ~ in its text), plus the commander, bracket, profile summary, stats (curve, types, pips vs sources, roles), problems, what's short, and the fingerprint. Maybeboard cards are listed by name only.",
    'Use it when: reading a deck before researching or editing; it is usually one call. For full detail on a few cards pass cards: [names]; for maybeboard text pass boards: ["maybe"]; for prices, ids, other decks, tokens, odds or sources pass include. A big deck returns `next`: call again with cursor: next.',
    "Rules: SHORT n means n copies aren't owned; maybeboard cards count in nothing. Update lines with apply_changes; manage sources with deck_sources.",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  pagesItself: true,
  input: GetDeckInput,
  async run(context, input) {
    const view = await viewFor(context, input.deckId);
    if (view === null) return deckNotFound(input.deckId);
    if (input.cards !== undefined) return done(deckCardDetails(view, input.cards));
    const fullPayload = await fullDeckPayload(
      context,
      input.view === "full" ? input : { ...input, fields: undefined },
      view,
    );
    if (input.view === "full") return done(fullPayload);
    const profile = await deckProfileFor(context, input.deckId);
    return done(compactDeckPayload(view, input, fullPayload, profile));
  },
});

/** get_deck's older shape: an object per line, every section (view: "full"). */
async function fullDeckPayload(
  context: ToolContext,
  input: GetDeckInputValue,
  view: DeckView,
): Promise<Record<string, unknown>> {
  const problems = problemsOf(view);
  const stats = deckStats(view.lines);
  const { list, fingerprint: print } = listAndFingerprint(view);
  const handOdds = openingHandOdds(library(view.lines), {
    onTheDraw: false,
    freeMulligan: view.deck.format === "commander",
  });
  const toPercent = (probability: number) => Math.round(probability * 1000) / 10;
  const [rawTokens, combos, deckSources, storedProfile] = await Promise.all([
    deckTokenLines(
      context.container.db,
      view.deck.id,
      view.lines.map((line) => ({
        oracleId: line.oracleId,
        printingId: line.printingId,
        name: line.name,
        board: line.board,
      })),
    ),
    view.deck.format === "commander"
      ? combosForDeck(
          context.container.db,
          view.lines
            .filter((line) => line.board === "main" || line.board === "commander")
            .map((line) => line.oracleId),
        )
      : Promise.resolve(undefined),
    listDeckSources(context.container.db, context.actor.userId, input.deckId),
    getDeckProfile(context.container.db, context.actor.userId, input.deckId),
  ]);
  const checklist = rawTokens.map(toTokenChecklistItem);
  const missingCards = problems.flatMap((problem) => {
    if (problem.kind !== "Short") return [];
    const missing = Math.max(0, problem.needed - problem.owned);
    const line =
      view.lines.find((l) => l.oracleId === problem.oracleId && l.board !== "maybe") ??
      view.lines.find((l) => l.oracleId === problem.oracleId);
    const priceCents = line?.priceCents ?? null;
    const subtotalCents = priceCents === null ? null : missing * priceCents;
    return [
      {
        name: problem.name,
        oracleId: problem.oracleId,
        needed: problem.needed,
        owned: problem.owned,
        missing,
        price: moneyOrNull(priceCents),
        subtotal: moneyOrNull(subtotalCents),
        subtotalCents,
      },
    ];
  });
  const missingCopies = missingCards.reduce((sum, c) => sum + c.missing, 0);
  const missingTotalCents = missingCards.reduce((sum, c) => sum + (c.subtotalCents ?? 0), 0);
  const unpricedCount = missingCards.filter((c) => c.subtotalCents === null).length;
  const maybeboardCards = view.lines
    .filter((l) => l.board === "maybe")
    .map((l) => {
      const isBasic = /\bBasic\b.*\bLand\b/.test(l.typeLine);
      const missing = isBasic ? 0 : Math.max(0, l.quantity - l.owned);
      const subtotalCents = missing > 0 && l.priceCents !== null ? missing * l.priceCents : null;
      return {
        name: l.name,
        oracleId: l.oracleId,
        quantity: l.quantity,
        owned: l.owned,
        ...(l.ownedReal > 0 ? { ownedReal: l.ownedReal } : {}),
        missing,
        price: moneyOrNull(l.priceCents),
        ...(subtotalCents !== null ? { subtotal: money(subtotalCents) } : {}),
      };
    });

  const filteredLines = view.lines.filter((line) => {
    if (input.boards && input.boards.length > 0 && !input.boards.includes(line.board)) {
      return false;
    }
    if (input.tag !== undefined) {
      const needle = input.tag.trim().toLowerCase();
      if (!(line.tags ?? []).some((t) => t.toLowerCase() === needle)) return false;
    }
    if (input.singleTagOnly) {
      if (/\bLand\b/.test(line.typeLine) || (line.tags ?? []).length !== 1) return false;
    }
    return true;
  });

  const profileSummary = summarizeDeckProfile(storedProfile?.profile);
  const fullPayload: Record<string, unknown> = {
    ...(profileSummary !== null ? { profileSummary } : {}),
    deck: {
      id: view.deck.id,
      name: view.deck.name,
      format: view.deck.format,
      usesRealCards: view.deck.usesRealCards,
      grouping: view.deck.grouping,
      headings: view.deck.headings,
    },
    fingerprint: print,
    lines: filteredLines.map((line) => ({
      name: line.name,
      oracleId: line.oracleId,
      printingId: line.printingId,
      board: line.board,
      quantity: line.quantity,
      ...(line.heading !== null ? { heading: line.heading } : {}),
      ...(line.note !== null ? { note: line.note } : {}),
      tags: line.tags ?? [],
      owned: line.owned,
      ...(line.ownedReal > 0 ? { ownedReal: line.ownedReal } : {}),
      ...(line.otherDecks.length > 0
        ? {
            free: line.free,
            ...(input.includeOtherDecks
              ? {
                  otherDecks: line.otherDecks.map((use) => ({
                    deckId: use.deckId,
                    name: use.name,
                    quantity: use.quantity,
                  })),
                }
              : {}),
          }
        : {}),
      manaCost: line.manaCost,
      manaValue: line.manaValue,
      typeLine: line.typeLine,
      ...(line.isGameChanger ? { isGameChanger: true } : {}),
      ...(input.includeText ? { text: line.text } : {}),
      price: moneyOrNull(line.priceCents),
    })),
    stats: {
      cardCount: stats.cardCount,
      sideboardCount: stats.sideboardCount,
      lands: stats.lands,
      otherManaSources: stats.otherManaSources,
      averageManaValue: Math.round(stats.averageManaValue * 100) / 100,
      curve: stats.curve,
      types: stats.types,
      pips: stats.pips,
      sources: stats.sources,
      roles: stats.tags,
      value: money(stats.priceCents),
      costToComplete: money(missingTotalCents),
    },
    formatRules: formatRulesSummary(view.deck.format),
    cardLegalIn:
      view.deck.format !== "commander" && view.deck.format !== "limited"
        ? legalFormatsForCards(view.deck, (oracleId) => view.rules[oracleId])
        : null,
    roleTargets: roleTargets(view.deck.format),
    problems: problems.map(problemText),
    bracket: bracketOf(view, combos),
    openingHandOdds:
      handOdds === null
        ? null
        : {
            librarySize: handOdds.librarySize,
            lands: handOdds.lands,
            earlyRamp: handOdds.earlyRamp,
            playableLandsInOpening7Percent: toPercent(handOdds.opening.playableLands),
            playableAfterFirstMulliganPercent: toPercent(
              handOdds.opening.playableAfterFirstMulligan,
            ),
            threeLandsByTurn3Percent: toPercent(handOdds.landDrops[2].chance),
            fourLandsByTurn4Percent: toPercent(handOdds.landDrops[3].chance),
            earlyRampByTurn3Percent: toPercent(handOdds.rampByTurn3.atLeastOneEarlyRamp),
            twoLandsAndEarlyRampByTurn3Percent: toPercent(
              handOdds.rampByTurn3.twoLandsAndEarlyRamp,
            ),
          },
    tokens: {
      summary: summarizeTokenChecklist(rawTokens),
      items: checklist.map((item) => ({
        name: item.name,
        kind: item.kind,
        description: item.description,
        madeBy: item.madeBy,
        sideboardOnly: item.sideboardOnly,
      })),
    },
    list,
    shortList: shortList(problems, view.lines),
    toComplete: {
      missingCopies,
      total: money(missingTotalCents),
      ...(unpricedCount > 0 ? { unpricedCount } : {}),
      cards: missingCards.map((c) => ({
        name: c.name,
        oracleId: c.oracleId,
        needed: c.needed,
        owned: c.owned,
        missing: c.missing,
        price: c.price,
        subtotal: c.subtotal,
      })),
      ...(maybeboardCards.length > 0 ? { maybeboard: maybeboardCards } : {}),
    },
    deckSources: deckSources ?? [],
  };
  if (input.fields && input.fields.length > 0) {
    const selected: Record<string, unknown> = {};
    for (const field of input.fields) {
      if (field in fullPayload) selected[field] = fullPayload[field];
    }
    return selected;
  }
  return fullPayload;
}

/** Room kept under the response cap for the `next` cursor and JSON framing. */
const PAGE_MARGIN_BYTES = 800;

function jsonByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

/** Does this line pass get_deck's board, tag and single-tag filters? */
function passesLineFilters(line: DeckLine, input: GetDeckInputValue): boolean {
  if (input.tag !== undefined) {
    const needle = input.tag.trim().toLowerCase();
    if (!(line.tags ?? []).some((tag) => tag.toLowerCase() === needle)) return false;
  }
  if (input.singleTagOnly) {
    if (/\bLand\b/.test(line.typeLine) || (line.tags ?? []).length !== 1) return false;
  }
  return true;
}

/**
 * get_deck's compact view (design doc 61, section 5a): the deck header, stats and problems on the
 * first page, then card lines grouped by heading, paged by whole groups under the response cap.
 */
function compactDeckPayload(
  view: DeckView,
  input: GetDeckInputValue,
  fullPayload: Record<string, unknown>,
  profile: DeckPlanProfile | null,
): Record<string, unknown> {
  const requestedBoards = input.boards && input.boards.length > 0 ? input.boards : null;
  const shownBoards: readonly DeckLine["board"][] = requestedBoards ?? [
    "commander",
    "main",
    "side",
  ];
  const shownLines = view.lines.filter(
    (line) => shownBoards.includes(line.board) && passesLineFilters(line, input),
  );
  const groups = groupCompactLines(
    shownLines.map((line) => ({
      ...line,
      pinned: isKeyCard(line.name, profile, line.pinned === true),
      ...(line.board === "side" || line.board === "maybe"
        ? { heading: line.board === "side" ? "Sideboard" : "Maybeboard" }
        : {}),
    })),
    {
      byHeading: view.deck.grouping === "custom",
      headings: [...view.deck.headings, "Sideboard", "Maybeboard"],
      includeText: input.text,
    },
  );
  const cursor = input.cursor ?? 0;
  if (cursor > 0) {
    const page = pageCompactGroups(
      groups,
      MAX_TOOL_RESPONSE_BYTES - PAGE_MARGIN_BYTES - 200,
      cursor,
    );
    return {
      deck: { id: view.deck.id, name: view.deck.name },
      cards: page.cards,
      ...(page.next !== undefined ? { next: page.next } : {}),
    };
  }

  const stats = fullPayload.stats as Record<string, unknown>;
  const bracket = fullPayload.bracket as ReturnType<typeof bracketOf>;
  const problems = problemsOf(view);
  const missingLines = shortLinesOf(view, problems);
  const missingCopies = missingLines.reduce((sum, entry) => sum + entry.missing, 0);
  const header: Record<string, unknown> = {
    deck: {
      id: view.deck.id,
      name: view.deck.name,
      format: view.deck.format,
      ...(view.deck.format === "commander"
        ? {
            commander: view.lines
              .filter((line) => line.board === "commander")
              .map((line) => line.name),
          }
        : {}),
      cards: stats.cardCount,
      ...(stats.sideboardCount ? { sideboard: stats.sideboardCount } : {}),
      lands: stats.lands,
      averageManaValue: stats.averageManaValue,
      ...(bracket !== null
        ? {
            bracket: {
              target: bracket.target,
              estimate: bracket.summary,
              gameChangers: bracket.gameChangers,
              ...(bracket.overTarget !== null ? { overTarget: bracket.overTarget } : {}),
              ...(bracket.findings.length > 0
                ? { findings: bracket.findings.map((finding) => finding.text) }
                : {}),
            },
          }
        : {}),
    },
    ...(fullPayload.profileSummary !== undefined
      ? { profileSummary: fullPayload.profileSummary }
      : {}),
    fingerprint: fullPayload.fingerprint,
  };
  const maybeNames =
    requestedBoards === null
      ? view.lines.filter((line) => line.board === "maybe").map((line) => line.name)
      : [];
  const otherProblems = problems.filter((problem) => problem.kind !== "Short").map(problemText);
  const footer: Record<string, unknown> = {
    ...(maybeNames.length > 0 ? { maybe: maybeNames } : {}),
    stats: {
      curve: stats.curve,
      types: stats.types,
      pips: stats.pips,
      sources: stats.sources,
      otherManaSources: stats.otherManaSources,
      roles: stats.roles,
    },
    ...(otherProblems.length > 0 ? { problems: otherProblems } : {}),
    ...(missingLines.length > 0
      ? {
          short: {
            copies: missingCopies,
            cost: (stats.costToComplete as { text: string }).text,
            cards: missingLines.map((entry) =>
              entry.price === null
                ? `${entry.name} (${entry.missing})`
                : `${entry.name} (${entry.missing} × ${entry.price})`,
            ),
          },
        }
      : {}),
    ...includedSections(view, input, fullPayload),
    more: 'cards: [names] for full detail; boards: ["maybe"] for maybeboard text; include: prices | ids | owners | tokens | odds | sources | legality | list | formatRules.',
  };
  const budget =
    MAX_TOOL_RESPONSE_BYTES - jsonByteLength(header) - jsonByteLength(footer) - PAGE_MARGIN_BYTES;
  const page = pageCompactGroups(groups, Math.max(budget, 4_000), 0);
  return {
    ...header,
    cards: page.cards,
    ...(page.next !== undefined ? { next: page.next } : {}),
    ...footer,
  };
}

type ShortLine = Readonly<{ name: string; missing: number; price: string | null }>;

/** The cards the deck uses more copies of than the player owns, with the price of one. */
function shortLinesOf(view: DeckView, problems: readonly DeckProblem[]): ShortLine[] {
  return problems.flatMap((problem) => {
    if (problem.kind !== "Short") return [];
    const line = view.lines.find(
      (candidate) => candidate.oracleId === problem.oracleId && candidate.board !== "maybe",
    );
    const missing = Math.max(0, problem.needed - problem.owned);
    if (missing === 0) return [];
    const priceCents = line?.priceCents ?? null;
    return [
      { name: problem.name, missing, price: priceCents === null ? null : money(priceCents).text },
    ];
  });
}

/** The extra sections the compact view was asked for with `include`. */
function includedSections(
  view: DeckView,
  input: GetDeckInputValue,
  fullPayload: Record<string, unknown>,
): Record<string, unknown> {
  const wanted = new Set(input.include);
  const played = view.lines;
  const sections: Record<string, unknown> = {};
  if (wanted.has("prices")) {
    sections.prices = {
      value: (fullPayload.stats as { value: { text: string } }).value.text,
      cards: Object.fromEntries(
        played.flatMap((line) =>
          line.priceCents === null || line.isBasicLand
            ? []
            : [[line.name, money(line.priceCents).text] as const],
        ),
      ),
    };
  }
  if (wanted.has("ids")) {
    sections.ids = Object.fromEntries(
      played.map((line) => [line.name, { oracleId: line.oracleId, printingId: line.printingId }]),
    );
  }
  if (wanted.has("owners")) {
    sections.owners = Object.fromEntries(
      played
        .filter((line) => !line.isBasicLand)
        .map((line) => [
          line.name,
          {
            owned: line.owned,
            ...(line.ownedReal > 0 ? { real: line.ownedReal } : {}),
            free: line.free,
            ...(line.otherDecks.length > 0
              ? {
                  otherDecksCount: line.otherDecks.length,
                  otherDecks: line.otherDecks
                    .slice(0, 3)
                    .map((use) => `${use.name} (${use.quantity})`),
                }
              : {}),
          },
        ]),
    );
  }
  if (wanted.has("tokens")) sections.tokens = fullPayload.tokens;
  if (wanted.has("odds")) sections.openingHandOdds = fullPayload.openingHandOdds;
  if (wanted.has("sources")) sections.deckSources = fullPayload.deckSources;
  if (wanted.has("legality")) sections.cardLegalIn = fullPayload.cardLegalIn;
  if (wanted.has("list")) sections.list = fullPayload.list;
  if (wanted.has("formatRules")) {
    sections.formatRules = fullPayload.formatRules;
    sections.roleTargets = fullPayload.roleTargets;
  }
  return sections;
}

/** Full detail for the named cards in the deck (get_deck's `cards` input). */
function deckCardDetails(view: DeckView, names: readonly string[]): Record<string, unknown> {
  const notInDeck: string[] = [];
  const cards = names.flatMap((query) => {
    const needle = query.trim().toLowerCase();
    const matches = view.lines.filter((line) => {
      const fullName = line.name.toLowerCase();
      return (
        fullName === needle ||
        fullName.split(" // ").some((face) => face === needle) ||
        line.oracleId === query
      );
    });
    if (matches.length === 0) notInDeck.push(query);
    return matches.map((line) => ({
      name: line.name,
      board: line.board,
      quantity: line.quantity,
      ...(line.heading !== null ? { heading: line.heading } : {}),
      ...(line.note !== null ? { note: line.note } : {}),
      ...((line.tags ?? []).length > 0 ? { tags: line.tags } : {}),
      ...(line.role ? { role: line.role } : {}),
      ...(line.pinned ? { pinned: true } : {}),
      manaCost: line.manaCost,
      typeLine: line.typeLine,
      ...(line.printedStats ? { stats: line.printedStats } : {}),
      text:
        line.faceTexts !== undefined && line.faceTexts.length > 1
          ? line.faceTexts.join("\n//\n")
          : line.text,
      ...(line.keywords.length > 0 ? { keywords: line.keywords } : {}),
      ...(line.isGameChanger ? { isGameChanger: true } : {}),
      oracleId: line.oracleId,
      printingId: line.printingId,
      owned: line.owned,
      ...(line.ownedReal > 0 ? { ownedReal: line.ownedReal } : {}),
      free: line.free,
      ...(line.otherDecks.length > 0
        ? {
            otherDecks: line.otherDecks.map((use) => ({
              deckId: use.deckId,
              name: use.name,
              quantity: use.quantity,
            })),
          }
        : {}),
      price: moneyOrNull(line.priceCents),
    }));
  });
  return {
    deck: { id: view.deck.id, name: view.deck.name },
    cards,
    ...(notInDeck.length > 0 ? { notInDeck } : {}),
  };
}

export const createDeck = defineTool({
  name: "create_deck",
  title: "Create a deck",
  description: [
    "Makes a new, empty deck and returns its id. Optionally fills it from a list in the usual text format.",
    'Use it when: the player wants a new deck. Then add cards with set_deck_entry, or pass a whole list here ("Commander" / "Deck" / "Sideboard" / "Maybeboard" headings, or headings of the player\'s own such as "Ramp (2)", then lines like "1 Sol Ring").',
    `Rules: cards you don't own may be added; they show as short. ${HEADING_RULE} (So "Lands (37)" or "Creatures (25)" are ignored as custom headings; use e.g. "Mana base" if you want a custom heading.)`,
  ].join("\n"),
  scope: "decks:write",
  readOnly: false,
  input: z.object({
    name: z.string().min(1).max(60).describe("The deck's name, up to 60 characters."),
    format: z.enum(FORMATS).default("commander").describe("The deck's format."),
    list: z
      .string()
      .default("")
      .describe(
        'Optional cards to start with, one per line: "1 Sol Ring". Headings: Commander, Deck, Sideboard, Maybeboard.',
      ),
  }),
  async run(context, input) {
    const { decks } = context.container;
    const created = await decks.createDeck(context.actor, {
      name: input.name,
      format: input.format,
    });
    if (!created.ok) {
      return created.error.kind === "NameInvalid"
        ? failed(
            "NameInvalid",
            `Give the deck a name of up to ${created.error.maximum} characters.`,
          )
        : failed(
            "TooManyDecks",
            `You already have ${created.error.maximum} decks; that's the most.`,
          );
    }
    if (input.list.trim() === "") return done({ deckId: created.value, added: 0 });
    const imported = await decks.importList(context.actor, {
      deckId: created.value,
      text: input.list,
    });
    if (!imported.ok)
      return done({ deckId: created.value, added: 0, listError: imported.error.kind });
    return done({
      deckId: created.value,
      added: imported.value.added,
      unreadable: imported.value.unreadable,
      notFound: imported.value.notFound,
    });
  },
});

export const updateDeck = defineTool({
  name: "update_deck",
  title: "Rename a deck, change its format or target bracket",
  description: [
    "Changes a deck's name, format, target bracket, grouping, or whether your real cards count as owned in it. Leave out what stays the same.",
    "Target bracket (Commander decks only): the Commander bracket the player means the deck for, 1–5 (1 Exhibition, 2 Core, 3 Upgraded, 4 Optimized, 5 cEDH), or 0 for none. With one, get_deck warns when the cards go over it, and idea_candidates, similar_cards, idea_budget_upgrades and search_for_deck leave out cards that would. Changing the format away from Commander clears it.",
  ].join("\n"),
  scope: "decks:write",
  readOnly: false,
  input: z.object({
    deckId,
    name: z.string().min(1).max(60).optional().describe("A new name, up to 60 characters."),
    format: z.enum(FORMATS).optional().describe("A new format."),
    usesRealCards: z
      .boolean()
      .optional()
      .describe("Whether your real (paper) cards count as owned in this deck."),
    targetBracket: z
      .number()
      .int()
      .min(0)
      .max(5)
      .optional()
      .describe("The Commander bracket to aim for, 1–5, or 0 to clear it. Commander decks only."),
    grouping: z
      .enum(GROUPINGS)
      .optional()
      .describe(
        'How the deck list groups the main deck: "custom" by the deck\'s own headings, "type" by card type.',
      ),
  }),
  async run(context, input) {
    const result = await context.container.decks.updateDeck(context.actor, {
      deckId: DeckId.of(input.deckId),
      name: input.name,
      format: input.format,
      usesRealCards: input.usesRealCards,
      // 0 clears it: a plain number keeps the schema simple for small models (rule 9).
      targetBracket: input.targetBracket === 0 ? null : input.targetBracket,
      grouping: input.grouping,
    });
    if (!result.ok) {
      switch (result.error.kind) {
        case "DeckNotFound":
          return deckNotFound(input.deckId);
        case "NameInvalid":
          return failed(
            "NameInvalid",
            `Give the deck a name of up to ${result.error.maximum} characters.`,
          );
        case "TargetBracketInvalid":
          return failed("TargetBracketInvalid", "A target bracket is 1, 2, 3, 4 or 5.");
        case "TargetBracketNotCommander":
          return failed(
            "TargetBracketNotCommander",
            "Only Commander decks have a target bracket. Change the format to commander first, or leave targetBracket out.",
          );
        default:
          return assertNever(result.error);
      }
    }
    return done({ deckId: input.deckId, updated: true });
  },
});

export const setDeckEntry = defineTool({
  name: "set_deck_entry",
  title: "Set how many of a card a deck has",
  description: [
    "Sets how many copies of one card a deck has on one board: 0 removes it. It sets the count, it doesn't add to it.",
    "Use it when: adding, removing or changing a few cards. For many changes at once, use replace_deck_list.",
    'Rules: cards you don\'t own may be added (they show as short); prefer owned cards, and free ones (search free>0) over cards another deck uses. To move a card from another deck, set it to 0 there (the player decides; ask first). To set a card aside without removing it, set it to 0 on "main" and add it on "maybe". Check the result with get_deck.',
    'Heading & note (optional): put the card under a heading ("Ramp", "" clears it; main deck only) and/or explain why it is in the deck with note ("Combos with Deadeye Navigator", "" clears it). Leave either out to keep its current value.',
  ].join("\n"),
  scope: "decks:write",
  readOnly: false,
  input: z.object({
    deckId,
    card,
    quantity: z
      .number()
      .int()
      .min(0)
      .max(MAX_QUANTITY)
      .describe("How many copies the deck should have; 0 removes the card."),
    board,
    heading: z
      .string()
      .max(200)
      .optional()
      .describe('A heading of the deck\'s own for the card, e.g. "Ramp"; "" removes it.'),
    note: z
      .string()
      .max(400)
      .optional()
      .describe(
        `Why this card is in the deck (up to ${MAX_NOTE_LENGTH} characters); "" clears it.`,
      ),
    tags: z
      .array(z.string().min(1).max(40))
      .max(20)
      .optional()
      .describe(
        `Optional structured tags (prefer core tags: ${CORE_DECK_TAGS.join(", ")}; custom tags like "Blitz" allowed up to 25 distinct tags/deck); [] clears them.`,
      ),
  }),
  async run(context, input) {
    const found = await findCard(context.container.db, input.card);
    if (found === null) return cardNotFound(input.card);
    const result = await context.container.decks.setEntry(context.actor, {
      deckId: DeckId.of(input.deckId),
      oracleId: found.oracleId,
      board: input.board,
      quantity: input.quantity,
      ...(input.note !== undefined && input.quantity > 0
        ? { note: input.note === "" ? null : input.note }
        : {}),
      ...(input.tags !== undefined && input.quantity > 0 ? { tags: input.tags } : {}),
    });
    if (!result.ok) {
      switch (result.error.kind) {
        case "DeckNotFound":
          return deckNotFound(input.deckId);
        case "CardNotFound":
          return cardNotFound(input.card);
        case "QuantityInvalid":
          return failed("QuantityInvalid", `Use 0 to ${result.error.maximum} copies.`);
        case "NoteInvalid":
          return failed(
            "NoteInvalid",
            `Use up to ${result.error.maximum} characters for a line note (or "" to clear).`,
          );
      }
    }
    if (input.heading !== undefined && input.quantity > 0) {
      const headed = await context.container.decks.setEntryHeading(context.actor, {
        deckId: DeckId.of(input.deckId),
        oracleId: found.oracleId,
        board: input.board,
        // "" clears it: a plain string keeps the schema simple for small models (rule 9).
        heading: input.heading === "" ? null : input.heading,
      });
      if (!headed.ok) {
        // The count was saved; only the heading wasn't.
        return failed(
          headed.error.kind,
          `The count was saved, but not the heading. ${HEADING_RULE}`,
        );
      }
    }
    return done({
      deckId: input.deckId,
      card: found.name,
      board: input.board,
      quantity: input.quantity,
      ...(input.heading !== undefined && input.quantity > 0 ? { heading: input.heading } : {}),
      ...(input.note !== undefined && input.quantity > 0 ? { note: input.note } : {}),
      ...(input.tags !== undefined && input.quantity > 0 ? { tags: input.tags } : {}),
    });
  },
});

export const replaceDeckList = defineTool({
  name: "replace_deck_list",
  title: "Replace a deck's whole list",
  description: [
    "Replaces the deck's cards with a list in the usual text format, all or nothing.",
    "Use it when: making many changes at once. First call get_deck, edit its `list`, and send it back with the `fingerprint` get_deck gave.",
    'Inputs: list, with headings "Commander", "Deck", "Sideboard", "Maybeboard", the deck\'s own headings as "Ramp (9)" lines (as get_deck\'s list writes them when grouping is "custom"), and lines like "1 Sol Ring" or "1 Sol Ring (C21) 263" for a printing. A line without a printing keeps the printing the deck already has for that card; for a new card it uses your copy if you own one, otherwise the cheapest printing in the store (unnamedPrinting "cheapest", the default) or the card\'s standard printing ("standard").',
    "Returns: the new card count. If the deck changed since your get_deck (DeckChanged), call get_deck again and redo your edit. If some lines couldn't be used (ListProblems), nothing was saved: fix those lines.",
  ].join("\n"),
  scope: "decks:write",
  readOnly: false,
  input: z.object({
    deckId,
    list: z.string().min(1).describe("The deck's complete new list."),
    fingerprint: z.string().min(1).describe("The fingerprint from your latest get_deck."),
    unnamedPrinting: z
      .enum(["cheapest", "standard"])
      .default("cheapest")
      .describe(
        'For an unowned line that names no printing: "cheapest" in the store, or the card\'s "standard" printing.',
      ),
  }),
  async run(context, input) {
    const result = await context.container.decks.replaceList(context.actor, {
      deckId: DeckId.of(input.deckId),
      text: input.list,
      fingerprint: input.fingerprint,
      unnamedPrinting: input.unnamedPrinting,
    });
    if (!result.ok) {
      switch (result.error.kind) {
        case "DeckNotFound":
          return deckNotFound(input.deckId);
        case "DeckChanged":
          return failed(
            "DeckChanged",
            "The deck changed since your get_deck. Call get_deck again, redo the edit on its new list, and send its new fingerprint.",
          );
        case "ListTooLong":
          return failed("ListTooLong", `A list may have up to ${result.error.maximumLines} lines.`);
        case "ListProblems":
          return failed(
            "ListProblems",
            `Nothing was saved. Unreadable lines: ${JSON.stringify(result.error.unreadable)}. Cards not found: ${JSON.stringify(result.error.notFound)}.`,
          );
      }
    }
    return done({ deckId: input.deckId, cards: result.value.cards });
  },
});

export const choosePrinting = defineTool({
  name: "choose_printing",
  title: "Choose which printing a deck shows",
  description: [
    "Pins the printing and finish a deck line shows and exports, or clears the pin so it follows your copies again.",
    "Use it when: the player asks for a particular art or set. Get printing ids from get_card.",
  ].join("\n"),
  scope: "decks:write",
  readOnly: false,
  input: z.object({
    deckId,
    card,
    board,
    printingId: z
      .string()
      .default("")
      .describe("The printing to pin (from get_card), or empty to clear the pin."),
    finish: z.enum(["nonfoil", "foil", "etched"]).default("nonfoil").describe("The finish to pin."),
  }),
  async run(context, input) {
    const found = await findCard(context.container.db, input.card);
    if (found === null) return cardNotFound(input.card);
    const result = await context.container.decks.choosePrinting(context.actor, {
      deckId: DeckId.of(input.deckId),
      oracleId: found.oracleId,
      board: input.board,
      pinned:
        input.printingId === ""
          ? null
          : { printingId: PrintingId.of(input.printingId), finish: input.finish },
    });
    if (!result.ok) {
      switch (result.error.kind) {
        case "DeckNotFound":
          return deckNotFound(input.deckId);
        case "EntryNotFound":
          return failed(
            "EntryNotFound",
            `The deck has no ${found.name} on the ${input.board} board.`,
          );
        case "PrintingNotOfCard":
          return failed("PrintingNotOfCard", `That printing isn't a printing of ${found.name}.`);
        case "FinishNotAvailable":
          return failed("FinishNotAvailable", `That printing doesn't come in ${input.finish}.`);
      }
    }
    return done({ deckId: input.deckId, card: found.name, pinned: input.printingId !== "" });
  },
});

export const arrangeHeadings = defineTool({
  name: "arrange_headings",
  title: "Rename, merge, clear or order a deck's headings",
  description: [
    "Changes the deck's own headings (the groups the player sorts the main deck into, like \"Ramp\"; see get_deck's headings).",
    'Use it when: renaming a heading (from "Removal", to "Interaction"), merging one into another (to an existing heading), clearing one from every card (to ""), or putting them in a new order (order: every heading, once each). Give either from and to, or order.',
    "Rules: the player decides how their deck is organised; ask before reorganising it.",
  ].join("\n"),
  scope: "decks:write",
  readOnly: false,
  input: z.object({
    deckId,
    from: z.string().max(200).optional().describe("The heading to rename, merge or clear."),
    to: z
      .string()
      .max(200)
      .optional()
      .describe('Its new name, another heading to merge it into, or "" to clear it.'),
    order: z
      .array(z.string().max(200))
      .max(MAX_HEADINGS)
      .optional()
      .describe("Every heading of the deck, once each, in the new order."),
  }),
  async run(context, input) {
    const { decks } = context.container;
    const id = DeckId.of(input.deckId);
    if ((input.from === undefined) === (input.order === undefined)) {
      return failed("InputInvalid", "Give either from and to, or order.");
    }
    if (input.from !== undefined) {
      if (input.to === undefined)
        return failed("InputInvalid", 'Say what to rename it to (or "" to clear it).');
      const result = await decks.renameHeading(context.actor, {
        deckId: id,
        from: input.from,
        to: input.to === "" ? null : input.to,
      });
      if (!result.ok) {
        switch (result.error.kind) {
          case "DeckNotFound":
            return deckNotFound(input.deckId);
          case "HeadingNotFound":
            return failed(
              "HeadingNotFound",
              `The deck has no heading "${input.from}": see get_deck.`,
            );
          case "HeadingInvalid":
            return failed("HeadingInvalid", HEADING_RULE);
          default:
            return assertNever(result.error);
        }
      }
      return done({ deckId: input.deckId, from: input.from, to: input.to });
    }
    const result = await decks.orderHeadings(context.actor, {
      deckId: id,
      order: input.order ?? [],
    });
    if (!result.ok) {
      switch (result.error.kind) {
        case "DeckNotFound":
          return deckNotFound(input.deckId);
        case "HeadingOrderInvalid":
          return failed(
            "HeadingOrderInvalid",
            "Name every heading the deck has (get_deck's headings), each once.",
          );
        default:
          return assertNever(result.error);
      }
    }
    return done({ deckId: input.deckId, order: input.order });
  },
});

const roundTwo = (value: number) => Math.round(value * 100) / 100;

function formatPreviewResponse(
  preview: DeckChangePreview,
  saved: Readonly<{ saved: boolean; fingerprint: string }>,
) {
  return {
    deck: preview.deck,
    format: preview.format,
    targetSize: preview.targetSize,
    saved: saved.saved,
    fingerprint: saved.fingerprint,
    changes: preview.changes.map((change) => ({
      card: change.name,
      board: change.board,
      before: change.beforeQuantity,
      after: change.afterQuantity,
    })),
    before: {
      cardCount: preview.before.stats.cardCount,
      lands: preview.before.stats.lands,
      otherManaSources: preview.before.stats.otherManaSources,
      averageManaValue: roundTwo(preview.before.stats.averageManaValue),
      curve: preview.before.stats.curve,
      pips: preview.before.stats.pips,
      sources: preview.before.stats.sources,
      value: money(preview.before.stats.priceCents),
      shortTotal: preview.before.shortTotal,
    },
    after: {
      cardCount: preview.after.stats.cardCount,
      lands: preview.after.stats.lands,
      otherManaSources: preview.after.stats.otherManaSources,
      averageManaValue: roundTwo(preview.after.stats.averageManaValue),
      curve: preview.after.stats.curve,
      pips: preview.after.stats.pips,
      sources: preview.after.stats.sources,
      value: money(preview.after.stats.priceCents),
      shortTotal: preview.after.shortTotal,
    },
    priceDelta: money(preview.priceDeltaCents),
    roles: preview.roles
      .filter((role) => role.before !== role.after || role.target !== null)
      .map((role) => ({
        role: role.tag,
        label: TAG_LABELS[role.tag],
        before: role.before,
        after: role.after,
        target: role.target,
        ...(role.added.length > 0 ? { added: role.added } : {}),
        ...(role.removed.length > 0 ? { removed: role.removed } : {}),
      })),
    newlyMetRoles: preview.newlyMetRoles,
    newlyMissedRoles: preview.newlyMissedRoles,
    problems: {
      added: preview.problems.added.map(problemText),
      resolved: preview.problems.resolved.map(problemText),
      remaining: preview.problems.remaining.map(problemText),
    },
    newlyShort: preview.newlyShort.map((short) => ({
      card: short.name,
      needed: short.needed,
      owned: short.owned,
      missing: short.needed - short.owned,
    })),
    bracket:
      preview.bracket.before === null || preview.bracket.after === null
        ? null
        : {
            target: preview.targetBracket,
            before: estimateLabel(preview.bracket.before),
            after: estimateLabel(preview.bracket.after),
            findingsAfter: preview.bracket.after.findings.map(findingWithCards),
            overTargetAfter:
              preview.bracket.warningAfter === null
                ? null
                : bracketWarningText(preview.bracket.warningAfter),
          },
  };
}

function previewGuardrailWarnings(
  view: DeckView | null,
  profile: DeckPlanProfile | null,
  preview: DeckChangePreview,
): string[] {
  const warnings: string[] = [];
  for (const change of preview.changes) {
    if (!isPlayed(change.board)) continue;
    const line = view?.lines.find(
      (l) => l.name.toLowerCase() === change.name.toLowerCase() && l.board === change.board,
    );
    const pinned = line?.pinned === true;
    if (change.afterQuantity < change.beforeQuantity && isKeyCard(change.name, profile, pinned)) {
      const reason = profile?.keyCards.find(
        (k) => k.cardName.toLowerCase() === change.name.toLowerCase(),
      )?.reason;
      warnings.push(
        `Cutting ${pinned ? "pinned " : ""}keyCard: ${change.name} (${change.board} ${change.beforeQuantity} -> ${change.afterQuantity})${reason ? ` — ${reason}` : ""}`,
      );
    }
    if (change.afterQuantity > change.beforeQuantity && isAvoidCard(change.name, profile)) {
      const reason = profile?.avoid.find(
        (a) => a.cardName.toLowerCase() === change.name.toLowerCase(),
      )?.reason;
      warnings.push(`Adding avoid card: ${change.name}${reason ? ` — ${reason}` : ""}`);
    }
  }
  return warnings;
}

const PREVIEW_TTL_MS = 30 * 60 * 1000;

type StoredPreview = {
  userId: string;
  deckId: number;
  fingerprint: string;
  changesToSave: Array<{
    oracleId: string;
    board: (typeof BOARDS)[number];
    quantity?: number;
    note?: string | null;
    heading?: string | null;
    tags?: readonly string[];
    role?: string | null;
    pinned?: boolean;
  }>;
  preview: DeckChangePreview;
  expiresAtMs: number;
};

const pendingPreviews = new Map<string, StoredPreview>();

export const applyChangesTool = defineTool({
  name: "apply_changes",
  title: "Preview or apply a batch of changes to a deck",
  description: [
    "Pre-evaluates (and optionally saves) a batch of card changes to a deck: returns before/after for card count, curve, average mana value, roles vs targets, colors, Commander bracket, problems added/resolved/remaining, newly short cards, price difference, fingerprint, and a previewId. Each change can set quantity (0 removes; omit to update only note/heading/tags/role/pinned on an existing line), note, heading, tags, role (one-line job) and pinned.",
    "Use it when: testing swaps, cuts or additions before changing the player's deck, or applying multiple changes/notes/headings/tags at once. Leave save false (the default) to preview first, then save without resending changes by calling with { deckId, previewId, save: true } (or pass changes + fingerprint).",
    'Rules: all card names must match the catalog or nothing is previewed or saved. To move a card to the maybeboard, send two changes: 0 on "main" and its count on "maybe".',
  ].join("\n"),
  scope: "decks:write",
  readOnly: false,
  input: z.object({
    deckId,
    changes: z
      .array(
        z.object({
          card,
          quantity: z
            .number()
            .int()
            .min(0)
            .max(MAX_QUANTITY)
            .optional()
            .describe(
              "How many copies the deck should have on this board (0 removes); omit to keep existing quantity when updating note, heading, or tags.",
            ),
          board,
          note: z
            .string()
            .max(400)
            .optional()
            .describe(
              `Optional note explaining why this card is in the deck (up to ${MAX_NOTE_LENGTH} chars); "" clears it.`,
            ),
          heading: z
            .string()
            .max(200)
            .optional()
            .describe('Optional custom heading (e.g. "Ramp"); "" clears it.'),
          tags: z
            .array(z.string().min(1).max(40))
            .max(20)
            .optional()
            .describe(
              `Optional structured tags (prefer core tags: ${CORE_DECK_TAGS.join(", ")}; custom tags like "Blitz" allowed up to 25 distinct tags/deck); [] clears them.`,
            ),
          role: z
            .string()
            .max(MAX_ROLE_LENGTH)
            .optional()
            .describe(
              'Optional one-line job of this card in the deck (e.g. "Free sac outlet for Avacyn"); "" clears it.',
            ),
          pinned: z
            .boolean()
            .optional()
            .describe("Pin the card: tools never suggest cutting or replacing a pinned card."),
        }),
      )
      .min(1)
      .max(100)
      .optional()
      .describe(
        "Changes to preview or save (1 to 100 entries). Optional when saving with previewId.",
      ),
    save: z
      .boolean()
      .default(false)
      .describe(
        "False (the default) previews without saving; true saves all changes if fingerprint/previewId matches.",
      ),
    fingerprint: z
      .string()
      .optional()
      .describe(
        "Required when save is true without previewId: the fingerprint from get_deck or a preview.",
      ),
    previewId: z
      .string()
      .optional()
      .describe(
        "Optional previewId from a prior save: false call to commit without resending changes.",
      ),
  }),
  async run(context, input) {
    const nowMs = context.container.clock.now().getTime();
    for (const [id, item] of pendingPreviews.entries()) {
      if (item.expiresAtMs <= nowMs) pendingPreviews.delete(id);
    }

    if (input.save && input.previewId && (!input.changes || input.changes.length === 0)) {
      const stored = pendingPreviews.get(input.previewId);
      if (
        !stored ||
        stored.userId !== context.actor.userId ||
        stored.deckId !== input.deckId ||
        stored.expiresAtMs <= nowMs
      ) {
        return failed(
          "PreviewExpired",
          "That previewId is missing or expired. Preview the changes again.",
        );
      }
      const fp = input.fingerprint ?? stored.fingerprint;
      const result = await context.container.decks.applyChanges(context.actor, {
        deckId: DeckId.of(input.deckId),
        fingerprint: fp,
        changes: stored.changesToSave,
      });
      if (!result.ok) {
        switch (result.error.kind) {
          case "DeckNotFound":
            return deckNotFound(input.deckId);
          case "DeckChanged":
            return failed(
              "DeckChanged",
              "The deck changed since that preview. Preview again without saving.",
            );
          case "QuantityInvalid":
            return failed("QuantityInvalid", `Use 0 to ${result.error.maximum} copies.`);
          case "CardNotFound":
            return cardNotFound("one of the changed cards");
          case "NoteInvalid":
            return failed(
              "NoteInvalid",
              `Line notes must be 1 to ${result.error.maximum} characters (or "" to clear).`,
            );
          case "HeadingInvalid":
            return failed("HeadingInvalid", HEADING_RULE);
        }
      }
      pendingPreviews.delete(input.previewId);
      return done(
        formatPreviewResponse(stored.preview, {
          saved: true,
          fingerprint: result.value.fingerprint,
        }),
      );
    }

    if (!input.changes || input.changes.length === 0) {
      return failed("InputInvalid", "Pass changes (or a previewId with save: true).");
    }

    const saveFingerprint = input.fingerprint ?? "";
    if (input.save && saveFingerprint === "") {
      return failed(
        "InputInvalid",
        "Pass the fingerprint from get_deck or a prior preview (or previewId) when save is true.",
      );
    }
    const uniqueNames = [...new Set(input.changes.map((entry) => entry.card))];
    const resolvedEntries = await Promise.all(
      uniqueNames.map(async (name) => [name, await findCard(context.container.db, name)] as const),
    );
    const byName = new Map<string, string>();
    const missing: string[] = [];
    for (const [name, found] of resolvedEntries) {
      if (found === null) missing.push(name);
      else byName.set(name, found.oracleId);
    }
    if (missing.length > 0) {
      return failed(
        "CardNotFound",
        `Cards not in the catalog (nothing previewed or saved): ${missing.join(", ")}.`,
      );
    }

    for (const entry of input.changes) {
      if ((entry.quantity ?? 1) > 0 && entry.note !== undefined && entry.note !== "") {
        const checked = checkNote(entry.note);
        if (!checked.ok) {
          return failed(
            "NoteInvalid",
            `Line note for ${entry.card} must be 1 to ${checked.error.maximum} characters (or "" to clear).`,
          );
        }
      }
    }

    let existingView: DeckView | null = null;
    if (input.changes.some((c) => c.quantity === undefined)) {
      existingView = await viewFor(context, input.deckId);
      if (existingView === null) return deckNotFound(input.deckId);
    }

    const resolvedChanges: DeckChange[] = [];
    const changesToSave: StoredPreview["changesToSave"] = [];
    for (const entry of input.changes) {
      const oracleId = byName.get(entry.card);
      if (oracleId === undefined) continue;
      let resolvedQty = entry.quantity;
      if (resolvedQty === undefined) {
        const existingLine = existingView?.lines.find(
          (l) => l.oracleId === oracleId && l.board === entry.board,
        );
        if (!existingLine) {
          return failed(
            "QuantityInvalid",
            `${entry.card} is not on the ${entry.board} board; pass quantity to add it.`,
          );
        }
        resolvedQty = existingLine.quantity;
      }
      resolvedChanges.push({ oracleId, board: entry.board, quantity: resolvedQty });
      changesToSave.push({
        oracleId,
        board: entry.board,
        quantity: resolvedQty,
        ...(entry.note !== undefined && resolvedQty > 0
          ? { note: entry.note === "" ? null : entry.note }
          : {}),
        ...(entry.heading !== undefined && resolvedQty > 0
          ? { heading: entry.heading === "" ? null : entry.heading }
          : {}),
        ...(entry.tags !== undefined && resolvedQty > 0 ? { tags: entry.tags } : {}),
        ...(entry.role !== undefined && resolvedQty > 0
          ? { role: entry.role === "" ? null : entry.role }
          : {}),
        ...(entry.pinned !== undefined && resolvedQty > 0 ? { pinned: entry.pinned } : {}),
      });
    }

    const preview = await deckChangePreview(
      context.container.db,
      context.actor.userId,
      input.deckId,
      resolvedChanges,
    );
    if (preview === null) return deckNotFound(input.deckId);

    const [guardrailView, guardrailProfile] = await Promise.all([
      existingView !== null ? Promise.resolve(existingView) : viewFor(context, input.deckId),
      deckProfileFor(context, input.deckId),
    ]);
    const warnings = previewGuardrailWarnings(guardrailView, guardrailProfile, preview);

    if (!input.save) {
      const previewId = randomUUID();
      pendingPreviews.set(previewId, {
        userId: context.actor.userId,
        deckId: input.deckId,
        fingerprint: preview.fingerprint,
        changesToSave,
        preview,
        expiresAtMs: nowMs + PREVIEW_TTL_MS,
      });
      return done({
        ...formatPreviewResponse(preview, { saved: false, fingerprint: preview.fingerprint }),
        ...(warnings.length > 0 ? { warnings } : {}),
        previewId,
      });
    }

    const result = await context.container.decks.applyChanges(context.actor, {
      deckId: DeckId.of(input.deckId),
      fingerprint: saveFingerprint,
      changes: changesToSave,
    });
    if (!result.ok) {
      switch (result.error.kind) {
        case "DeckNotFound":
          return deckNotFound(input.deckId);
        case "DeckChanged":
          return failed(
            "DeckChanged",
            "The deck changed since that fingerprint. Preview again without saving to get the new fingerprint.",
          );
        case "QuantityInvalid":
          return failed("QuantityInvalid", `Use 0 to ${result.error.maximum} copies.`);
        case "CardNotFound":
          return cardNotFound("one of the changed cards");
        case "NoteInvalid":
          return failed(
            "NoteInvalid",
            `Line notes must be 1 to ${result.error.maximum} characters (or "" to clear).`,
          );
        case "HeadingInvalid":
          return failed("HeadingInvalid", HEADING_RULE);
      }
    }

    return done({
      ...formatPreviewResponse(preview, { saved: true, fingerprint: result.value.fingerprint }),
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  },
});

function formatSnapshotComparison(comparison: SnapshotComparison) {
  return {
    ...formatPreviewResponse(comparison, { saved: true, fingerprint: comparison.fingerprint }),
    compared: {
      before: comparison.beforeSide,
      after: comparison.afterSide,
    },
  };
}

export const deckSnapshotsTool = defineTool({
  name: "deck_snapshots",
  title: "List or compare deck snapshots",
  description: [
    "Lists a deck's saved point-in-time snapshots, or compares a saved snapshot against the current deck (or a second snapshot).",
    "Use it when: reviewing before/after cuts across size, curve, roles vs targets, problems, Commander bracket, value and card changes.",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({
    deckId,
    snapshotId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('The "before" snapshot id to compare. Omit to list saved snapshots.'),
    compareToSnapshotId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Optional "after" snapshot id. Omit to compare against the live deck.'),
  }),
  async run(context, input) {
    if (input.snapshotId === undefined) {
      const list = await listDeckSnapshots(
        context.container.db,
        context.actor.userId,
        input.deckId,
      );
      if (list === null) return deckNotFound(input.deckId);
      return done({
        deckId: input.deckId,
        snapshots: list.map((snapshot) => ({
          id: Number(snapshot.id),
          label: snapshot.label,
          format: snapshot.format,
          cardCount: snapshot.cardCount,
          createdAt: snapshot.createdAt.toISOString(),
        })),
      });
    }
    const comparison = await compareDeckSnapshot(
      context.container.db,
      context.actor.userId,
      input.deckId,
      input.snapshotId,
      input.compareToSnapshotId,
    );
    if (comparison === null) {
      const list = await listDeckSnapshots(
        context.container.db,
        context.actor.userId,
        input.deckId,
      );
      if (list === null) return deckNotFound(input.deckId);
      return failed(
        "SnapshotNotFound",
        `Deck ${input.deckId} does not have snapshot ${input.snapshotId}${
          input.compareToSnapshotId !== undefined ? ` or ${input.compareToSnapshotId}` : ""
        }.`,
      );
    }
    return done(formatSnapshotComparison(comparison));
  },
});

export const snapshotDeckTool = defineTool({
  name: "snapshot_deck",
  title: "Save, restore or delete a deck snapshot",
  description: [
    'Saves a point-in-time snapshot of a deck (e.g. "Before cuts", up to 30 per deck), restores a deck back to a snapshot, or deletes a snapshot.',
    "Use it when: before starting multi-step cuts or swaps so you and the player can compare before/after with deck_snapshots, or when rolling back.",
    "Rules: restoring overwrites the deck's current card list, ask the player first before restoring or deleting a snapshot.",
  ].join("\n"),
  scope: "decks:write",
  readOnly: false,
  input: z.object({
    deckId,
    action: z
      .enum(["save", "restore", "delete"])
      .default("save")
      .describe(
        '"save" creates a snapshot, "restore" reverts the deck to one, "delete" removes one.',
      ),
    label: z
      .string()
      .max(200)
      .optional()
      .describe(
        `Label when action is "save" (1 to ${MAX_SNAPSHOT_LABEL_LENGTH} characters, e.g. "Before cuts").`,
      ),
    snapshotId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Snapshot id when action is "restore" or "delete".'),
    fingerprint: z
      .string()
      .optional()
      .describe('Optional fingerprint from get_deck when action is "restore".'),
  }),
  async run(context, input) {
    const id = DeckId.of(input.deckId);
    if (input.action === "save") {
      if (input.label === undefined) {
        return failed("InputInvalid", 'Pass a label when action is "save" (e.g. "Before cuts").');
      }
      const saved = await context.container.decks.saveSnapshot(context.actor, {
        deckId: id,
        label: input.label,
      });
      if (!saved.ok) {
        switch (saved.error.kind) {
          case "DeckNotFound":
            return deckNotFound(input.deckId);
          case "SnapshotLabelInvalid":
            return failed(
              "SnapshotLabelInvalid",
              `Snapshot label must be 1 to ${saved.error.maximum} characters.`,
            );
          case "TooManySnapshots":
            return failed(
              "TooManySnapshots",
              `A deck can store up to ${MAX_SNAPSHOTS_PER_DECK} snapshots; delete an older one first.`,
            );
          default:
            return assertNever(saved.error);
        }
      }
      return done({
        deckId: input.deckId,
        snapshotId: Number(saved.value),
        action: "saved",
      });
    }

    if (input.snapshotId === undefined) {
      return failed("InputInvalid", `Pass snapshotId when action is "${input.action}".`);
    }
    const snapshotId = SnapshotId.of(input.snapshotId);

    if (input.action === "restore") {
      const restored = await context.container.decks.restoreSnapshot(context.actor, {
        deckId: id,
        snapshotId,
        ...(input.fingerprint !== undefined && input.fingerprint !== ""
          ? { fingerprint: input.fingerprint }
          : {}),
      });
      if (!restored.ok) {
        switch (restored.error.kind) {
          case "DeckNotFound":
            return deckNotFound(input.deckId);
          case "SnapshotNotFound":
            return failed(
              "SnapshotNotFound",
              `Deck ${input.deckId} has no snapshot ${input.snapshotId}.`,
            );
          case "DeckChanged":
            return failed(
              "DeckChanged",
              "The deck changed since your fingerprint. Call get_deck again before restoring.",
            );
          default:
            return assertNever(restored.error);
        }
      }
      return done({
        deckId: input.deckId,
        snapshotId: input.snapshotId,
        action: "restored",
        cards: restored.value.cards,
        fingerprint: restored.value.fingerprint,
      });
    }

    const deleted = await context.container.decks.deleteSnapshot(context.actor, {
      deckId: id,
      snapshotId,
    });
    if (!deleted.ok) {
      switch (deleted.error.kind) {
        case "DeckNotFound":
          return deckNotFound(input.deckId);
        case "SnapshotNotFound":
          return failed(
            "SnapshotNotFound",
            `Deck ${input.deckId} has no snapshot ${input.snapshotId}.`,
          );
        default:
          return assertNever(deleted.error);
      }
    }
    return done({
      deckId: input.deckId,
      snapshotId: input.snapshotId,
      action: "deleted",
    });
  },
});

export const deckTokensTool = defineTool({
  name: "deck_tokens",
  title: "List deck tokens and emblems",
  description: [
    "Lists every token, emblem, and helper card (such as The Monarch) created by a deck's cards, with types/stats, rules text, and which cards make each one.",
    "Use it when: preparing a token/emblem checklist for game night or checking whether sideboard cards introduce extra tokens.",
    "Rules: maybeboard cards are ignored. Use board: 'played' to hide sideboard-only tokens, or kind to filter to tokens, emblems, or helpers.",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({
    deckId,
    board: z
      .enum(["all", "played"])
      .default("all")
      .describe(
        "'all' includes sideboard-only tokens; 'played' keeps only main deck and commander tokens.",
      ),
    kind: z
      .enum(["all", ...TOKEN_KINDS])
      .default("all")
      .describe("Filter by kind: 'all', 'token', 'emblem', or 'helper'."),
  }),
  async run(context, input) {
    const view = await viewFor(context, input.deckId);
    if (view === null) return deckNotFound(input.deckId);
    const [rawTokens, combos] = await Promise.all([
      deckTokenLines(
        context.container.db,
        view.deck.id,
        view.lines.map((line) => ({
          oracleId: line.oracleId,
          printingId: line.printingId,
          name: line.name,
          board: line.board,
        })),
      ),
      view.deck.format === "commander"
        ? combosForDeck(
            context.container.db,
            view.lines
              .filter((line) => line.board === "main" || line.board === "commander")
              .map((line) => line.oracleId),
          )
        : Promise.resolve(undefined),
    ]);
    const summary = summarizeTokenChecklist(rawTokens);
    const items = filterTokenChecklist(rawTokens.map(toTokenChecklistItem), {
      board: input.board,
      kind: input.kind,
    });
    return done({
      deckId: view.deck.id,
      deckName: view.deck.name,
      summary,
      showing: items.length,
      items: items.map((item) => ({
        oracleId: item.oracleId,
        name: item.name,
        kind: item.kind,
        description: item.description,
        ...(item.text !== "" ? { text: item.text } : {}),
        colors: item.colors,
        hasBack: item.hasBack,
        madeBy: item.madeBy,
        boards: item.boards,
        sideboardOnly: item.sideboardOnly,
        includedInProxies: item.includedInProxies,
        art: {
          id: item.art.id,
          setCode: item.art.setCode,
          setName: item.art.setName,
          collectorNumber: item.art.collectorNumber,
        },
      })),
    });
  },
});

export const openingHandOddsTool = defineTool({
  name: "opening_hand_odds",
  title: "Opening-hand and turn-3 ramp odds",
  description: [
    "Computes exact hypergeometric probabilities (as percentages 0–100) for a deck's main-deck library: opening 7 land distribution, 1-mulligan keep odds, land drops on curve (turns 1–5), early ramp (MV <= 3) by turn 3, joint odds of having both lands and early ramp by turn 3, and optional odds for a specific role tag or named card group.",
    "Use it when: checking land count consistency, evaluating early ramp reliability, or calculating draw odds for a role or combo piece by a given turn.",
    "Rules: only main-deck cards count (commanders start in the command zone; sideboard and maybeboard are excluded). Probabilities use exact hypergeometric sums without replacement.",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({
    deckId,
    onTheDraw: z
      .boolean()
      .default(false)
      .describe("True counts the extra draw step on turn 1 (going second)."),
    freeMulligan: z
      .boolean()
      .optional()
      .describe("Whether the first mulligan is free (defaults to true for Commander)."),
    tag: z
      .enum(TAGS)
      .optional()
      .describe("Optional role tag to compute custom draw probability by `byTurn`."),
    cardNames: z
      .array(z.string().min(1))
      .max(20)
      .optional()
      .describe("Optional main-deck card names (case-insensitive) to group for draw probability."),
    byTurn: z
      .number()
      .int()
      .min(1)
      .max(10)
      .default(3)
      .describe("Turn number (1–10) for the optional tag or cardNames lookup."),
    atLeast: z
      .number()
      .int()
      .min(1)
      .max(7)
      .default(1)
      .describe("Minimum copies needed for the optional tag or cardNames lookup."),
  }),
  async run(context, input) {
    const view = await viewFor(context, input.deckId);
    if (view === null) return deckNotFound(input.deckId);
    const cards = library(view.lines);
    const freeMulligan = input.freeMulligan ?? view.deck.format === "commander";
    const odds = openingHandOdds(cards, { onTheDraw: input.onTheDraw, freeMulligan });
    if (odds === null) {
      return done({
        deckId: view.deck.id,
        deckName: view.deck.name,
        librarySize: 0,
        odds: null,
      });
    }
    const toPercent = (probability: number) => Math.round(probability * 1000) / 10;

    let customQuery: {
      tag?: string;
      cardNames?: string[];
      byTurn: number;
      atLeast: number;
      matchingCopies: number;
      chancePercent: number;
    } | null = null;

    if (input.tag !== undefined || (input.cardNames !== undefined && input.cardNames.length > 0)) {
      const wantedNames = new Set(input.cardNames?.map((name) => name.trim().toLowerCase()) ?? []);
      const matchingCopies = cards.filter((card) => {
        if (input.tag !== undefined && card.tags.includes(input.tag)) return true;
        if (wantedNames.size > 0 && wantedNames.has(card.name.toLowerCase())) return true;
        return false;
      }).length;
      customQuery = {
        ...(input.tag !== undefined ? { tag: input.tag } : {}),
        ...(input.cardNames !== undefined && input.cardNames.length > 0
          ? { cardNames: input.cardNames }
          : {}),
        byTurn: input.byTurn,
        atLeast: input.atLeast,
        matchingCopies,
        chancePercent: toPercent(
          chanceByTurn(
            odds.librarySize,
            matchingCopies,
            input.byTurn,
            input.onTheDraw,
            input.atLeast,
          ),
        ),
      };
    }

    return done({
      deckId: view.deck.id,
      deckName: view.deck.name,
      librarySize: odds.librarySize,
      lands: odds.lands,
      ramp: odds.ramp,
      earlyRamp: odds.earlyRamp,
      earlyRampMaxManaValue: EARLY_RAMP_MAX_MV,
      onTheDraw: odds.onTheDraw,
      freeMulligan: odds.freeMulligan,
      openingHand7: {
        tooFewLands0To1Percent: toPercent(odds.opening.tooFewLands),
        playableLands2To5Percent: toPercent(odds.opening.playableLands),
        tooManyLands6To7Percent: toPercent(odds.opening.tooManyLands),
        earlyRampPercent: toPercent(odds.opening.atLeastOneEarlyRamp),
        playableAfterFirstMulliganPercent: toPercent(odds.opening.playableAfterFirstMulligan),
      },
      landDrops: odds.landDrops.map((row) => ({
        turn: row.turn,
        cardsSeen: row.cardsSeen,
        targetLands: row.targetLands,
        chancePercent: toPercent(row.chance),
      })),
      rampByTurn3: {
        cardsSeen: odds.rampByTurn3.cardsSeen,
        atLeastOneEarlyRampPercent: toPercent(odds.rampByTurn3.atLeastOneEarlyRamp),
        atLeastOneAnyRampPercent: toPercent(odds.rampByTurn3.atLeastOneAnyRamp),
        twoLandsAndEarlyRampPercent: toPercent(odds.rampByTurn3.twoLandsAndEarlyRamp),
        threeLandsAndEarlyRampPercent: toPercent(odds.rampByTurn3.threeLandsAndEarlyRamp),
      },
      roles: odds.roles.map((row) => ({ label: row.label, chancePercent: toPercent(row.chance) })),
      ...(customQuery !== null ? { customQuery } : {}),
    });
  },
});

const COUNTED_ROLES = ["ramp", "draw", "removal", "wipe"] as const;

/** The cards behind each role count in deck_facts, tagged the same way the counts are. */
function cardsBehindRoleCounts(lines: readonly DeckLine[]): Record<string, string[]> {
  const roleCards: Record<string, string[]> = { ramp: [], draw: [], removal: [], wipe: [] };
  for (const line of lines) {
    if (!isPlayed(line.board)) continue;
    const tags = cardTags({
      typeLine: line.typeLine,
      text: line.text ?? "",
      producedMana: line.producedMana,
    });
    for (const role of COUNTED_ROLES) {
      if (tags.includes(role) && !roleCards[role].includes(line.name)) {
        roleCards[role].push(line.name);
      }
    }
  }
  return roleCards;
}

export const auditDeckTool = defineTool({
  name: "deck_facts",
  title: "Deck facts and heuristic diagnostics",
  description: [
    "Returns read-only deck facts in one call: legality problems, Commander bracket & two-card combos, role counts vs. targets, mana/color balance, ownership gaps, 500-hand London-mulligan goldfish summary, and a low-reliability heuristic score (never a verdict or cut list).",
    "Use it when: checking a deck's construction facts, role counts, mana curve, and legality before researching cards.",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({
    deckId,
    includeMaybe: z
      .boolean()
      .default(false)
      .describe("Include maybeboard cards in the bracket estimate."),
  }),
  async run(context, input) {
    const [report, view] = await Promise.all([
      auditDeck(context.container.db, context.actor.userId, input.deckId),
      viewFor(context, input.deckId),
    ]);
    if (report === null || view === null) return deckNotFound(input.deckId);
    const { score, ...facts } = report;
    const roleCards = cardsBehindRoleCounts(view.lines);

    const bracketWithMaybe =
      input.includeMaybe && view.deck.format === "commander"
        ? estimateBracket(
            view.deck.format,
            view.lines.filter((l) => isPlayed(l.board) || l.board === "maybe").map(bracketLine),
          )
        : undefined;

    return done({
      provenance: heuristicProvenance("regex heuristic & deck stats", ["card text", "edhrec"]),
      ...facts,
      roleCards,
      ...(bracketWithMaybe ? { bracketWithMaybe } : {}),
      heuristicScore: score,
    });
  },
});

export const simulateOpeningHandsTool = defineTool({
  name: "simulate_opening_hands",
  title: "Monte Carlo London-mulligan opening hand simulator",
  description: [
    "Simulates N opening hands (default 1,000) with London mulligans and smart bottoming to measure keepable-hand rate, mulligan distribution, early play & early ramp rates, turn-3 land drop rate, mana screw/flood, and 3 sample kept hands.",
    "Use it when: testing whether a deck's land count and early curve actually produce playable opening hands.",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({
    deckId,
    trials: z
      .number()
      .int()
      .min(100)
      .max(5000)
      .default(1000)
      .describe("Number of simulated opening hands (100 to 5000)."),
    minLands: z
      .number()
      .int()
      .min(0)
      .max(7)
      .default(2)
      .describe("Minimum lands required for a keepable hand."),
    maxLands: z
      .number()
      .int()
      .min(0)
      .max(7)
      .default(4)
      .describe("Maximum lands allowed for a keepable hand."),
    requireEarlyPlay: z
      .boolean()
      .default(true)
      .describe("Whether a keepable hand must contain a non-land card with mana value <= 3."),
    freeMulligan: z
      .boolean()
      .optional()
      .describe("Whether the first mulligan is free (defaults to true for Commander)."),
    onTheDraw: z
      .boolean()
      .default(false)
      .describe("True counts the extra draw step on turn 1 (going second)."),
    seed: z
      .string()
      .max(64)
      .optional()
      .describe("Optional deterministic RNG seed for reproducible simulations."),
    mustCastBy: z
      .object({
        card: z
          .string()
          .min(1)
          .optional()
          .describe("Card name (defaults to the deck's commander)."),
        turn: z
          .number()
          .int()
          .min(1)
          .max(10)
          .describe("Target turn by which the card must be castable."),
      })
      .optional()
      .describe(
        "Measure % of games where a card (commander by default) is castable by turn N, counting dorks, rocks, and profile cost reducers.",
      ),
  }),
  async run(context, input) {
    const [view, storedProfile] = await Promise.all([
      viewFor(context, input.deckId),
      getDeckProfile(context.container.db, context.actor.userId, input.deckId),
    ]);
    if (view === null) return deckNotFound(input.deckId);
    const cards = library(view.lines);
    const freeMulligan = input.freeMulligan ?? view.deck.format === "commander";

    let mustCastByOption: MustCastByOption | undefined;
    if (input.mustCastBy) {
      const cmdLine = view.lines.find((l) => l.board === "commander");
      const targetName = input.mustCastBy.card ?? cmdLine?.name;
      if (!targetName) {
        return failed("CardNotFound", "No commander found; specify mustCastBy.card.");
      }
      const line =
        view.lines.find((l) => l.name.toLowerCase() === targetName.toLowerCase()) ?? cmdLine;
      if (!line) {
        return failed("CardNotFound", `Card "${targetName}" is not in the deck.`);
      }
      const effMv = effectiveManaValue(
        line.manaValue ?? 0,
        {
          typeLine: line.typeLine,
          oracleText: line.text,
          isCommander: line.board === "commander",
        },
        storedProfile?.profile,
        0,
      );
      mustCastByOption = {
        cardName: line.name,
        manaValue: effMv,
        turn: input.mustCastBy.turn,
        inLibrary: line.board !== "commander",
        colorPips: colorPips(line.manaCost),
      };
    }

    const report = simulateOpeningHands(cards, {
      rng: seededRng(input.seed ?? `sim-${view.deck.id}`),
      trials: input.trials,
      minLands: input.minLands,
      maxLands: input.maxLands,
      requireEarlyPlay: input.requireEarlyPlay,
      freeMulligan,
      onTheDraw: input.onTheDraw,
      ...(mustCastByOption ? { mustCastBy: mustCastByOption } : {}),
    });
    return done({
      deckId: view.deck.id,
      deckName: view.deck.name,
      freeMulligan,
      onTheDraw: input.onTheDraw,
      ...(mustCastByOption
        ? {
            mustCastBy: {
              card: mustCastByOption.cardName,
              turn: mustCastByOption.turn,
              effectiveManaValue: mustCastByOption.manaValue,
              castablePct: report.mustCastByPct ?? 0,
            },
          }
        : {}),
      ...report,
    });
  },
});

export const upgradeRoadmapTool = defineTool({
  name: "idea_upgrade_roadmap",
  title: "Tiered cut/add upgrade ideas by budget",
  description: [
    "Builds a heuristic tiered upgrade idea list across budget milestones (default $25 / $75 / $200), pairing regex-matched cuts with bracket-compliant store cards. Raw ideas to verify against card text and outside sources, not recommendations.",
    "Use it when: the player asks for rough phased upgrade ideas across budget milestones ($25, $75, $200). Read-only.",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({
    deckId,
    tiersCents: z
      .array(z.number().int().min(100))
      .min(1)
      .max(5)
      .optional()
      .describe("Cumulative budget milestones in cents (defaults to [2500, 7500, 20000])."),
    maxSwapsPerTier: z
      .number()
      .int()
      .min(1)
      .max(10)
      .default(5)
      .describe("Maximum number of cut/add ideas per tier (1 to 10, default 5)."),
  }),
  async run(context, input) {
    const result = await deckUpgradeRoadmap(
      context.container.db,
      context.actor.userId,
      input.deckId,
      {
        tiersCents: input.tiersCents,
        maxSwapsPerTier: input.maxSwapsPerTier,
      },
    );
    if (result === null) return deckNotFound(input.deckId);
    return done({
      provenance: heuristicProvenance("regex heuristic + cut ranking", ["card text", "edhrec"]),
      deckId: result.deck.id,
      deckName: result.deck.name,
      heuristicBaseScore: result.roadmap.baseScore,
      hiddenOverTarget: result.hiddenOverTarget,
      tiers: result.roadmap.tiers.map((tier) => ({
        tierBudget: money(tier.tierBudgetCents),
        tierSpent: money(tier.tierSpentCents),
        cumulativeBudget: money(tier.cumulativeBudgetCents),
        cumulativeSpent: money(tier.cumulativeSpentCents),
        heuristicScoreAfter: tier.scoreAfter,
        heuristicScoreDeltaFromBase: tier.scoreDeltaFromBase,
        swaps: tier.swaps
          .map((swap) => ({
            cut: swap.cut.name,
            add: swap.add.card.name,
            addPrice: money(swap.priceCents),
            regexReasons: swap.add.reasons,
          }))
          .sort((a, b) => a.cut.localeCompare(b.cut)),
      })),
    });
  },
});

export const diffDeckTool = defineTool({
  name: "diff_deck",
  title: "Diff deck against a snapshot with score delta",
  description: [
    "Compares a deck's before/after state across cards, curve, roles, legality, Commander bracket, value, and whole-deck scoreDeck delta.",
    "Defaults to comparing the deck's most recent saved snapshot against the live deck when snapshot ids are omitted. Read-only.",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({
    deckId,
    beforeSnapshotId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Optional "before" snapshot id; defaults to the most recent saved snapshot.'),
    afterSnapshotId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Optional "after" snapshot id; omit to compare against the live deck.'),
  }),
  async run(context, input) {
    let beforeId = input.beforeSnapshotId;
    if (beforeId === undefined) {
      const list = await listDeckSnapshots(
        context.container.db,
        context.actor.userId,
        input.deckId,
      );
      if (list === null) return deckNotFound(input.deckId);
      if (list.length === 0) {
        return failed(
          "NoSnapshots",
          `Deck ${input.deckId} has no saved snapshots yet. Save one with snapshot_deck first.`,
        );
      }
      beforeId = Number(list[0].id);
    }
    const comparison = await compareDeckSnapshot(
      context.container.db,
      context.actor.userId,
      input.deckId,
      beforeId,
      input.afterSnapshotId,
    );
    if (comparison === null) {
      return failed(
        "SnapshotNotFound",
        `Deck ${input.deckId} does not have snapshot ${beforeId}${
          input.afterSnapshotId !== undefined ? ` or ${input.afterSnapshotId}` : ""
        }.`,
      );
    }
    return done({
      ...formatSnapshotComparison(comparison),
      scoreBefore: comparison.scoreBefore,
      scoreAfter: comparison.scoreAfter,
      scoreDelta: comparison.scoreDelta,
    });
  },
});

export const listPackagesTool = defineTool({
  name: "list_packages",
  title: "List saved card packages",
  description: [
    "Lists the player's reusable card packages (named themed bundles such as 'Sultai self-mill' or 'Sacrifice outlets').",
    "Use it when: the player asks what packages they have saved or before applying one with apply_package.",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({}),
  async run(context) {
    const packages = await listCardPackages(context.container.db, context.actor.userId);
    return done({ packages });
  },
});

export const createPackageTool = defineTool({
  name: "create_package",
  title: "Save a reusable card package",
  description: [
    "Saves a named, reusable bundle of cards that can be dropped into any deck later with apply_package.",
    "Use it when: the player wants to save a themed group of cards (ramp package, self-mill core, interaction suite) for reuse across decks.",
  ].join("\n"),
  scope: "decks:write",
  readOnly: false,
  input: z.object({
    name: z.string().min(1).max(80).describe("Package name, up to 80 characters."),
    description: z.string().max(400).optional().describe("Optional short description."),
    tags: z.array(z.string().min(1).max(40)).optional().describe("Optional theme or role tags."),
    entries: z
      .array(
        z.object({
          oracleId: z.string().min(1).describe("Oracle id of the card."),
          quantity: z.number().int().min(1).max(99).default(1).describe("Number of copies."),
          heading: z.string().max(MAX_HEADING_LENGTH).optional().describe("Optional deck heading."),
          note: z.string().max(MAX_NOTE_LENGTH).optional().describe("Optional card note."),
        }),
      )
      .min(1)
      .describe("Cards to include in the package."),
  }),
  async run(context, input) {
    const created = await createCardPackage(context.container.db, context.actor.userId, {
      name: input.name,
      description: input.description,
      tags: input.tags,
      entries: input.entries,
    });
    return done(created);
  },
});

export const applyPackageTool = defineTool({
  name: "apply_package",
  title: "Apply a card package to a deck",
  description: [
    "Inserts the cards from a saved package into a deck's mainboard, skipping cards already in the deck, outside the Commander color identity, or illegal in the deck's format.",
    "Use it when: the player wants to drop a reusable card package into a deck.",
  ].join("\n"),
  scope: "decks:write",
  readOnly: false,
  input: z.object({
    deckId,
    packageId: z.number().int().positive().describe("The saved package's id."),
  }),
  async run(context, input) {
    const plan = await applyCardPackageToDeck(
      context.container.db,
      context.actor.userId,
      input.deckId,
      input.packageId,
    );
    if (plan === null) {
      return failed(
        "NotFound",
        `Deck ${input.deckId} or package ${input.packageId} was not found.`,
      );
    }
    return done({
      addedCount: plan.toAdd.length,
      added: plan.toAdd,
      skippedCount: plan.skipped.length,
      skipped: plan.skipped,
    });
  },
});

export const mulliganDrillTool = defineTool({
  name: "mulligan_drill",
  title: "Deal a mulligan trainer hand",
  description: [
    "Deals a 7-card opening hand from a deck for a keep-or-mulligan drill, with land count, early ramp count, and a recommended keep/mulligan decision.",
    "Use it when: the player wants to practice mulligan decisions on a deck.",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({
    deckId,
    mulliganCount: z
      .number()
      .int()
      .min(0)
      .max(4)
      .default(0)
      .describe("How many mulligans have already been taken (0–4)."),
  }),
  async run(context, input) {
    const view = await deckView(context.container.db, context.actor.userId, input.deckId);
    if (view === null) return deckNotFound(input.deckId);
    const cards = library(view.lines);
    const rng = seededRng(context.container.seeds.newSeed());
    const drill = dealMulliganDrill(cards, rng, { mulliganCount: input.mulliganCount });
    return done({
      hand: drill.hand.map((c) => ({
        name: c.name,
        isLand: c.isLand,
        manaValue: c.manaValue ?? null,
        tags: c.tags,
      })),
      mulliganCount: drill.mulliganCount,
      keepCount: drill.keepCount,
      landCount: drill.landCount,
      earlyRampCount: drill.earlyRampCount,
      earlyPlayCount: drill.earlyPlayCount,
      recommended: drill.recommended,
      reasons: drill.reasons,
    });
  },
});

export const deckScorecardTool = defineTool({
  name: "deck_scorecard",
  title: "Get a deck scorecard summary",
  description: [
    "Returns a compact scorecard for a deck: overall score, bracket with reasons, role coverage, cast-on-curve %, and goldfish keepable rate.",
    "Use it when: the player wants a shareable summary or quick health check of a deck.",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({ deckId }),
  async run(context, input) {
    const report = await deckScorecard(context.container.db, context.actor.userId, input.deckId);
    if (report === null) return deckNotFound(input.deckId);
    return done({
      provenance: heuristicProvenance("regex heuristic & deck stats", ["card text", "edhrec"]),
      deck: report.deck,
      heuristicScore: report.score.total,
      bracket: report.bracket,
      roles: report.roles,
      averageCastOnCurvePct: report.mana.averageCastOnCurvePct,
      keepableRatePct: report.goldfish.keepableRatePct,
      legality: report.legality,
    });
  },
});

export const edhrecCommanderTool = defineTool({
  name: "edhrec_commander",
  title: "Fetch EDHREC commander data",
  description: [
    "Fetches EDHREC's JSON data for a commander (cached 24 hours): deck count, theme tags with counts, cards with inclusion %, synergy score and EDHREC category, average decklist (if available), and source URL.",
    "Use it when: gathering outside popularity data for a commander before judging cards by their rules text.",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({
    commander: z.string().min(1).describe("The commander's English name."),
    theme: z
      .string()
      .min(1)
      .optional()
      .describe('Optional EDHREC theme slug or name (e.g. "reanimator").'),
    budget: z
      .enum(["budget", "expensive"])
      .optional()
      .describe("Optional EDHREC budget filter: budget or expensive."),
    category: z
      .string()
      .min(1)
      .optional()
      .describe('Optional category filter (e.g. "High Synergy Cards", "Creatures").'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .default(60)
      .describe("Maximum number of cards to return (default 60, max 200)."),
  }),
  async run(context, input) {
    let data;
    try {
      data = await context.container.outsideData.fetchEdhrecCommander(input.commander, {
        theme: input.theme,
        budget: input.budget,
      });
    } catch (error) {
      return failed(
        "EdhrecUnavailable",
        `Could not reach EDHREC: ${error instanceof Error ? error.message : "unknown error"}.`,
      );
    }
    if (data === null) {
      return failed("EdhrecNotFound", `No EDHREC page found for "${input.commander}".`);
    }
    const filteredCards = input.category
      ? data.cards.filter((c) => c.category.toLowerCase() === input.category?.toLowerCase())
      : data.cards;
    return done({
      framing: EDHREC_FRAMING,
      sourceUrl: data.sourceUrl,
      fetchedAt: data.fetchedAt,
      cached: data.cached,
      commander: data.commander,
      deckCount: data.deckCount,
      population: {
        deckCount: data.deckCount,
        bracket: "all-bracket",
        theme: input.theme ?? null,
        note: `Percentages come from ${data.deckCount.toLocaleString("en-US")} ${input.theme ? `${input.theme} ` : ""}decks across all brackets on EDHREC (not filtered to a single Commander bracket).`,
      },
      themes: data.themes.slice(0, 20),
      totalCards: filteredCards.length,
      cards: filteredCards.slice(0, input.limit),
      averageDecklist: data.averageDecklist,
    });
  },
});

export const compareToEdhrecTool = defineTool({
  name: "compare_to_edhrec",
  title: "Compare a deck to EDHREC popularity data",
  description: [
    "Compares a Commander deck against EDHREC data for its commander (cached 24 hours), all unranked and sorted alphabetically with no cut/add verdicts: your cards with inclusion % & synergy, high-inclusion EDHREC cards you don't run (with owned flag), and your cards EDHREC doesn't list.",
    "Use it when: seeing where a deck differs from the crowd without treating popularity as a verdict.",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({
    deckId,
    theme: z.string().min(1).optional().describe('Optional EDHREC theme (e.g. "reanimator").'),
  }),
  async run(context, input) {
    const view = await deckView(context.container.db, context.actor.userId, input.deckId);
    if (view === null) return deckNotFound(input.deckId);

    const commanders = view.lines.filter((l) => l.board === "commander");
    const commander = commanders[0];
    if (!commander) {
      return failed(
        "CommanderMissing",
        "Put a commander on the commander board first before calling compare_to_edhrec.",
      );
    }
    const commanderName = commander.name;

    let data;
    try {
      data = await context.container.outsideData.fetchEdhrecCommander(commanderName, {
        theme: input.theme,
      });
    } catch (error) {
      return failed(
        "EdhrecUnavailable",
        `Could not reach EDHREC: ${error instanceof Error ? error.message : "unknown error"}.`,
      );
    }
    if (data === null) {
      return failed("EdhrecNotFound", `No EDHREC page found for "${commanderName}".`);
    }

    const edhrecByLower = new Map<string, (typeof data.cards)[number]>();
    for (const card of data.cards) {
      edhrecByLower.set(card.name.toLowerCase(), card);
      const front = card.name.split(" // ")[0]?.toLowerCase();
      if (front && !edhrecByLower.has(front)) edhrecByLower.set(front, card);
    }

    const playedLines = view.lines.filter((l) => isPlayed(l.board) && l.board !== "commander");
    const deckCardKeys = new Set<string>();
    for (const line of playedLines) {
      deckCardKeys.add(line.name.toLowerCase());
      const front = line.name.split(" // ")[0]?.toLowerCase();
      if (front) deckCardKeys.add(front);
    }

    const inDeckWithEdhrec: {
      name: string;
      inclusionPct: number;
      synergy: number;
      category: string;
    }[] = [];
    const inDeckNotOnEdhrec: { name: string; typeLine: string }[] = [];

    for (const line of playedLines) {
      const match =
        edhrecByLower.get(line.name.toLowerCase()) ??
        edhrecByLower.get(line.name.split(" // ")[0]?.toLowerCase() ?? "");
      if (match) {
        inDeckWithEdhrec.push({
          name: line.name,
          inclusionPct: match.inclusionPct,
          synergy: match.synergy,
          category: match.category,
        });
      } else if (!line.isBasicLand) {
        inDeckNotOnEdhrec.push({ name: line.name, typeLine: line.typeLine });
      }
    }

    const notInDeckCandidates = data.cards.filter((card) => {
      const lower = card.name.toLowerCase();
      const front = lower.split(" // ")[0] ?? lower;
      return !deckCardKeys.has(lower) && !deckCardKeys.has(front);
    });
    const highInclusion = notInDeckCandidates.filter((c) => c.inclusionPct >= 20).slice(0, 60);
    const missingPool =
      highInclusion.length > 0
        ? highInclusion
        : [...notInDeckCandidates].sort((a, b) => b.inclusionPct - a.inclusionPct).slice(0, 30);

    const ownedChecks =
      missingPool.length > 0
        ? await checkOwnedCards(
            context.container.db,
            context.actor.userId,
            missingPool.map((c) => c.name),
          )
        : [];
    const ownedByQuery = new Map(ownedChecks.map((c) => [c.query.toLowerCase(), c]));

    const highInclusionNotInDeck = missingPool
      .map((card) => {
        const check = ownedByQuery.get(card.name.toLowerCase());
        const owned = check && check.inCatalog ? check.ownedTotal > 0 : false;
        return {
          name: card.name,
          inclusionPct: card.inclusionPct,
          synergy: card.synergy,
          category: card.category,
          inCatalog: check ? check.inCatalog : false,
          owned,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    inDeckWithEdhrec.sort((a, b) => a.name.localeCompare(b.name));
    inDeckNotOnEdhrec.sort((a, b) => a.name.localeCompare(b.name));

    return done({
      framing: EDHREC_FRAMING,
      sourceUrl: data.sourceUrl,
      fetchedAt: data.fetchedAt,
      cached: data.cached,
      commander: data.commander,
      deckCount: data.deckCount,
      population: {
        deckCount: data.deckCount,
        bracket: "all-bracket",
        theme: input.theme ?? null,
        note: `Percentages come from ${data.deckCount.toLocaleString("en-US")} ${input.theme ? `${input.theme} ` : ""}decks across all brackets on EDHREC (not filtered to a single Commander bracket).`,
      },
      inDeckWithEdhrec,
      highInclusionNotInDeck,
      inDeckNotOnEdhrec,
    });
  },
});

export const deckSourcesTool = defineTool({
  name: "deck_sources",
  title: "Save or list research sources for a deck",
  description: [
    "Saves an outside research source (URL, title, what it was used for) onto a deck and returns all saved sources, or lists them when url is omitted.",
    "Use it when: recording EDHREC pages, guides, primers, or Spellbook/Scryfall links used for a deck so later sessions don't redo the research.",
  ].join("\n"),
  scope: "decks:write",
  readOnly: false,
  input: z.object({
    deckId,
    url: z.string().url().optional().describe("Optional source URL to save."),
    title: z.string().min(1).max(200).optional().describe("Title of the source."),
    usedFor: z
      .string()
      .max(500)
      .optional()
      .describe("What this source was used for (e.g. 'blitz rulings, mana base targets')."),
  }),
  async run(context, input) {
    if (input.url !== undefined) {
      const sources = await addDeckSource(
        context.container.db,
        context.actor.userId,
        input.deckId,
        {
          url: input.url,
          title: input.title ?? input.url,
          usedFor: input.usedFor ?? "",
        },
        context.container.clock.now(),
      );
      if (sources === null) return deckNotFound(input.deckId);
      const added = sources.find((s) => s.url === input.url) ?? sources[sources.length - 1] ?? null;
      return done({ deckId: input.deckId, source: added, totalCount: sources.length });
    }
    const sources = await listDeckSources(context.container.db, context.actor.userId, input.deckId);
    if (sources === null) return deckNotFound(input.deckId);
    return done({ deckId: input.deckId, sources });
  },
});

function compactCard(card: GoldfishCard) {
  return {
    key: card.key,
    name: card.name,
    ...(card.manaCost ? { manaCost: card.manaCost } : {}),
    typeLine: card.typeLine,
    isLand: card.isLand,
  };
}

function compactGoldfishBoard(state: GoldfishState) {
  return {
    kept: state.kept,
    turn: state.turn,
    mulligans: state.mulligans,
    toBottom: state.toBottom,
    landsPlayedThisTurn: state.landsPlayedThisTurn,
    commandCasts: state.commandCasts,
    manaPool: state.manaPool,
    ...(state.endStepQueue.length > 0 ? { endStepQueue: state.endStepQueue } : {}),
    libraryCount: state.library.length,
    lastActionNote: state.lastActionNote,
    hand: state.hand.map(compactCard),
    battlefield: state.battlefield.map((p) => ({
      ...compactCard(p.card),
      tapped: p.tapped,
      enteredTurn: p.enteredTurn,
      ...(p.haste ? { haste: true } : {}),
      ...(p.blitzed ? { blitzed: true } : {}),
    })),
    commandZone: state.commandZone.map(compactCard),
    graveyard: state.graveyard.map(compactCard),
    exile: state.exile.map(compactCard),
  };
}

export const goldfishStartTool = defineTool({
  name: "goldfish_start",
  title: "Start an interactive goldfish session",
  description: [
    "Shuffles a deck, deals a 7-card opening hand, puts commanders in the command zone, and returns a short-lived sessionId (24h TTL) for turn-by-turn playtesting via goldfish_step.",
    "Manual tabletop simulator: does not enforce mana costs, tapped-land conditions, or automatic triggers, and a single run is one sample rather than statistical proof (use simulate_opening_hands for odds).",
    "Use it when: testing actual turns 1–5 lines of play, mulligan decisions, and sequencing.",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({
    deckId,
    onTheDraw: z.boolean().default(false).describe("True draws a card on turn 1 (going second)."),
    freeMulligan: z
      .boolean()
      .optional()
      .describe("Whether the first mulligan is free (defaults to true for Commander)."),
    seed: z
      .string()
      .max(64)
      .optional()
      .describe("Optional deterministic RNG seed for reproducible hands."),
  }),
  async run(context, input) {
    const view = await viewFor(context, input.deckId);
    if (view === null) return deckNotFound(input.deckId);
    const seed = input.seed ?? `gf-${view.deck.id}-${context.container.clock.now().getTime()}`;
    const result = await context.container.goldfishSessions.start({
      userId: context.actor.userId,
      deckId: DeckId.of(view.deck.id),
      format: view.deck.format,
      lines: view.lines,
      rng: seededRng(seed),
      onTheDraw: input.onTheDraw,
      freeMulligan: input.freeMulligan,
    });
    if (!result.ok) {
      return failed("EmptyDeck", "This deck has no main-deck cards to goldfish.");
    }
    return done({
      sessionId: result.value.sessionId,
      deckId: view.deck.id,
      deckName: view.deck.name,
      expiresAt: result.value.expiresAt.toISOString(),
      ...compactGoldfishBoard(result.value.state),
    });
  },
});

const goldfishZone = z.enum([
  "library",
  "hand",
  "battlefield",
  "graveyard",
  "exile",
  "commandZone",
]);

/** A goldfish step's refusal in words, for the model. */
function goldfishErrorText(error: GoldfishSessionError): string {
  switch (error.kind) {
    case "SessionNotFound":
      return "That goldfish session expired or never existed; start one with goldfish_start.";
    case "MulliganNotAllowed":
    case "CastNotAllowed":
      return error.reason;
    case "PendingBottom":
      return `Put ${error.remaining} card(s) on the bottom first (action "bottom" with keys).`;
    case "CardNotFound":
      return `No card with key ${error.key}${error.zone ? ` in ${error.zone}` : ""}.`;
    case "NotALand":
      return `${error.name} (${error.key}) isn't a land.`;
    case "LandLimitReached":
      return `You already played ${error.landsPlayedThisTurn} land(s) this turn.`;
    case "InvalidBottomSelection":
      return `Choose exactly ${error.expected} card(s) to bottom; got ${error.received}.`;
    case "InsufficientMana": {
      const pool = (Object.entries(error.available) as [string, number][])
        .filter(([, amount]) => amount > 0)
        .map(([color, amount]) => `${amount}${color}`)
        .join(" ");
      return `Can't pay ${error.required} for ${error.card}; the pool has ${pool === "" ? "nothing" : pool}. Tap lands or mana sources first, or pass strict: false.`;
    }
    case "EmptyLibrary":
      return "The library is empty.";
    default:
      return assertNever(error);
  }
}

export const goldfishStepTool = defineTool({
  name: "goldfish_step",
  title: "Advance an interactive goldfish session",
  description: [
    "Performs one tabletop action on an active goldfish session (mulligan, bottom, next_turn, draw, play_land, cast, tap, untap, move, shuffle_library, or peek_library) and returns the updated compact board.",
    "Use it when: stepping through mulligans and turns 1–5 after goldfish_start.",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({
    sessionId: z.string().min(1).max(64).describe("The sessionId returned by goldfish_start."),
    action: z
      .enum([
        "mulligan",
        "bottom",
        "keep",
        "next_turn",
        "end_step",
        "draw",
        "play_land",
        "cast",
        "tap",
        "untap",
        "move",
        "shuffle_library",
        "peek_library",
      ])
      .describe("Tabletop action to perform on the goldfish session."),
    key: z
      .string()
      .optional()
      .describe("Card key (from hand/battlefield/etc.) for single-card actions."),
    keys: z.array(z.string()).optional().describe("Card keys to put on bottom for 'bottom'."),
    count: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe("Card count for 'draw' or 'peek_library'."),
    from: goldfishZone.optional().describe("Source zone for 'cast' or 'move'."),
    to: z
      .enum([
        "hand",
        "battlefield",
        "graveyard",
        "exile",
        "commandZone",
        "library_top",
        "library_bottom",
      ])
      .optional()
      .describe("Destination zone for 'cast' or 'move'."),
    tapped: z.boolean().optional().describe("Enter tapped for 'play_land' or 'cast'."),
    alt: z
      .enum(["blitz"])
      .optional()
      .describe(
        "Alternative casting mode (e.g. 'blitz' grants haste and queues end-step sacrifice + draw).",
      ),
    strict: z
      .boolean()
      .default(true)
      .describe("Enforce manaPool payment on 'cast' (defaults to true; set false to bypass)."),
    costReductionGeneric: z
      .number()
      .int()
      .min(0)
      .max(20)
      .optional()
      .describe("Generic mana cost reduction to apply to 'cast' (e.g. Henzie blitz discount)."),
    ignoreLandLimit: z
      .boolean()
      .optional()
      .describe("Allow extra land drop on 'play_land' (e.g. Exploration)."),
    seed: z
      .string()
      .max(64)
      .optional()
      .describe("Optional RNG seed for 'mulligan' or 'shuffle_library'."),
  }),
  async run(context, input) {
    const rng = seededRng(
      input.seed ?? `gf-step-${input.sessionId}-${context.container.clock.now().getTime()}`,
    );
    let stepInput: GoldfishStepInput;
    switch (input.action) {
      case "peek_library":
        stepInput = { kind: "peek_library", count: input.count ?? 3 };
        break;
      case "mulligan":
        stepInput = { kind: "action", action: { kind: "mulligan", rng } };
        break;
      case "shuffle_library":
        stepInput = { kind: "action", action: { kind: "shuffle_library", rng } };
        break;
      case "bottom":
        stepInput = { kind: "action", action: { kind: "bottom", keys: input.keys ?? [] } };
        break;
      case "keep":
        stepInput = { kind: "action", action: { kind: "keep" } };
        break;
      case "next_turn":
        stepInput = { kind: "action", action: { kind: "next_turn" } };
        break;
      case "end_step":
        stepInput = { kind: "action", action: { kind: "end_step" } };
        break;
      case "draw":
        stepInput = { kind: "action", action: { kind: "draw", count: input.count } };
        break;
      case "play_land":
        if (!input.key) return failed("MissingKey", "Provide 'key' for play_land.");
        stepInput = {
          kind: "action",
          action: {
            kind: "play_land",
            key: input.key,
            tapped: input.tapped,
            ignoreLandLimit: input.ignoreLandLimit,
          },
        };
        break;
      case "cast": {
        if (!input.key) return failed("MissingKey", "Provide 'key' for cast.");
        const castFrom =
          input.from === "hand" ||
          input.from === "commandZone" ||
          input.from === "graveyard" ||
          input.from === "exile"
            ? input.from
            : undefined;
        const castTo =
          input.to === "battlefield" || input.to === "graveyard" || input.to === "exile"
            ? input.to
            : undefined;
        stepInput = {
          kind: "action",
          action: {
            kind: "cast",
            key: input.key,
            from: castFrom,
            to: castTo,
            tapped: input.tapped,
            alt: input.alt,
            strict: input.strict,
            costReductionGeneric: input.costReductionGeneric,
          },
        };
        break;
      }
      case "tap":
      case "untap":
        if (!input.key) return failed("MissingKey", `Provide 'key' for ${input.action}.`);
        stepInput = { kind: "action", action: { kind: input.action, key: input.key } };
        break;
      case "move": {
        if (!input.key || !input.from || !input.to) {
          return failed("MissingMoveArgs", "Provide 'key', 'from', and 'to' for move.");
        }
        const action: GoldfishAction = {
          kind: "move",
          key: input.key,
          from: input.from,
          to: input.to,
        };
        stepInput = { kind: "action", action };
        break;
      }
    }

    const result = await context.container.goldfishSessions.step({
      userId: context.actor.userId,
      sessionId: input.sessionId,
      step: stepInput,
    });
    if (!result.ok) {
      return failed(result.error.kind, goldfishErrorText(result.error));
    }
    return done({
      sessionId: result.value.sessionId,
      expiresAt: result.value.expiresAt.toISOString(),
      ...compactGoldfishBoard(result.value.state),
      ...(result.value.peeked ? { peeked: result.value.peeked.map(compactCard) } : {}),
    });
  },
});

const costReducerSchema = z.object({
  cardName: z.string().min(1),
  scope: z.enum(["blitz", "creature_power_gte_4", "commander", "all_spells"]),
  genericReduction: z.number().int().min(0).max(20),
  perCommandCast: z.boolean().optional(),
});

const keyCardPinSchema = z.object({
  cardName: z.string().min(1),
  reason: z.string().min(1).max(200),
});

const avoidCardSchema = z.object({
  cardName: z.string().min(1),
  reason: z.string().min(1).max(200),
});

export const getDeckProfileTool = defineTool({
  name: "get_deck_profile",
  title: "Get deck profile & primer",
  description: [
    "Returns everything the deck's primer holds: the structured profile (plan, landTarget, roleTargets, keyCards, avoid, costReducers, winCons, declaredCombos, mulligan, pilotNotes), the Markdown primer's section names (or its full text with includePrimer), and each card's one-line role and pin.",
    "Use it when: starting any deck review, so you know the plan, the cards never to cut (keyCards and pinned cards), the avoid list and cost reducers before suggesting changes.",
    "Edit with: set_deck_profile (structured fields), set_primer (one ## section, or the whole primer), apply_changes (a card's role and pinned).",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({
    deckId,
    includePrimer: z.boolean().default(false).describe("Include full Markdown primer text."),
  }),
  async run(context, input) {
    const [stored, view] = await Promise.all([
      getDeckProfile(context.container.db, context.actor.userId, input.deckId),
      viewFor(context, input.deckId),
    ]);
    if (!stored) return deckNotFound(input.deckId);
    const resolvedTargets = resolveDeckProfileTargets(stored.profile);
    const lines = view?.lines ?? [];
    const cardRoles = Object.fromEntries(
      lines.flatMap((line) => (line.role ? [[line.name, line.role] as const] : [])),
    );
    const pinnedCards = [
      ...new Set(lines.filter((line) => line.pinned === true).map((line) => line.name)),
    ];
    return done({
      deckId: stored.deckId,
      deckName: stored.deckName,
      format: stored.format,
      profile: stored.profile,
      resolvedTargets,
      primerSections: primerSections(stored.primer),
      ...(input.includePrimer ? { primer: stored.primer ?? "" } : {}),
      ...(pinnedCards.length > 0 ? { pinnedCards } : {}),
      ...(Object.keys(cardRoles).length > 0 ? { cardRoles } : {}),
    });
  },
});

export const setDeckProfileTool = defineTool({
  name: "set_deck_profile",
  title: "Update deck profile",
  description: [
    "Patches structured fields on a deck's profile (plan, landTarget, roleTargets, keyCards, avoid, costReducers, winCons, declaredCombos, mulligan, pilotNotes).",
    "Use it when: recording the deck's plan, pinning keyCards, ruling out avoid cards, or setting commander costReducers and custom land/role targets.",
  ].join("\n"),
  scope: "decks:write",
  readOnly: false,
  input: z.object({
    deckId,
    plan: z
      .string()
      .max(1000)
      .optional()
      .describe("One or two sentences describing the deck's plan."),
    landTarget: z
      .number()
      .int()
      .min(0)
      .max(99)
      .optional()
      .describe("Target land count for the deck."),
    roleTargets: z
      .object({
        ramp: z.number().int().min(0).max(99).optional(),
        draw: z.number().int().min(0).max(99).optional(),
        removal: z.number().int().min(0).max(99).optional(),
        wipe: z.number().int().min(0).max(99).optional(),
      })
      .optional()
      .describe("Target counts for ramp, draw, removal, and wipe."),
    keyCards: z
      .array(keyCardPinSchema)
      .max(50)
      .optional()
      .describe(
        "Pinned key cards with a one-line reason (never suggested for cut or replacement).",
      ),
    avoid: z
      .array(avoidCardSchema)
      .max(100)
      .optional()
      .describe("Ruled-out cards with reasons; excluded by search and idea tools."),
    costReducers: z
      .array(costReducerSchema)
      .max(20)
      .optional()
      .describe(
        "Declarative cost reducers (e.g. Henzie blitz -1 per cast; Goreclaw -2 for power 4+).",
      ),
    winCons: z
      .array(z.string().min(1).max(300))
      .max(20)
      .optional()
      .describe("Win condition lines."),
    declaredCombos: z
      .array(z.string().min(1).max(300))
      .max(30)
      .optional()
      .describe("Declared combos for bracket disclosure."),
    mulligan: z.string().max(1000).optional().describe("Short mulligan heuristic."),
    pilotNotes: z.string().max(2000).optional().describe("Short pilot notes."),
  }),
  async run(context, input) {
    const patch: Partial<DeckPlanProfile> = {};
    if (input.plan !== undefined) patch.plan = input.plan;
    if (input.landTarget !== undefined) patch.landTarget = input.landTarget;
    if (input.roleTargets !== undefined) patch.roleTargets = input.roleTargets;
    if (input.keyCards !== undefined) patch.keyCards = input.keyCards;
    if (input.avoid !== undefined) patch.avoid = input.avoid;
    if (input.costReducers !== undefined) patch.costReducers = input.costReducers;
    if (input.winCons !== undefined) patch.winCons = input.winCons;
    if (input.declaredCombos !== undefined) patch.declaredCombos = input.declaredCombos;
    if (input.mulligan !== undefined) patch.mulligan = input.mulligan;
    if (input.pilotNotes !== undefined) patch.pilotNotes = input.pilotNotes;

    const updated = await updateDeckProfile(
      context.container.db,
      context.actor.userId,
      input.deckId,
      patch,
      context.container.clock.now(),
    );
    if (!updated) return deckNotFound(input.deckId);

    const warnings: string[] = [];
    if (input.keyCards !== undefined || input.avoid !== undefined) {
      const view = await viewFor(context, input.deckId);
      const deckNames = new Set(
        (view?.lines ?? []).flatMap((l) => [
          l.name.toLowerCase(),
          ...l.name.split(" // ").map((f) => f.toLowerCase()),
        ]),
      );
      const playedNames = new Set(
        (view?.lines ?? [])
          .filter((l) => isPlayed(l.board))
          .flatMap((l) => [
            l.name.toLowerCase(),
            ...l.name.split(" // ").map((f) => f.toLowerCase()),
          ]),
      );
      const namesToCheck = [
        ...(input.keyCards ?? []).map((k) => k.cardName),
        ...(input.avoid ?? []).map((a) => a.cardName),
      ];
      const resolved = new Map(
        await Promise.all(
          [...new Set(namesToCheck)].map(
            async (name) => [name, await findCard(context.container.db, name)] as const,
          ),
        ),
      );
      for (const entry of input.keyCards ?? []) {
        const found = resolved.get(entry.cardName);
        if (!found) {
          warnings.push(`Unknown card in keyCards: "${entry.cardName}" (not in catalog).`);
        } else if (view && !deckNames.has(found.name.toLowerCase())) {
          warnings.push(`keyCard "${found.name}" is not currently in this deck.`);
        }
      }
      for (const entry of input.avoid ?? []) {
        const found = resolved.get(entry.cardName);
        if (!found) {
          warnings.push(`Unknown card in avoid: "${entry.cardName}" (not in catalog).`);
        } else if (view && playedNames.has(found.name.toLowerCase())) {
          warnings.push(`avoid card "${found.name}" is currently in this deck.`);
        }
      }
    }

    return done({
      deckId: updated.deckId,
      profile: updated.profile,
      resolvedTargets: resolveDeckProfileTargets(updated.profile),
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  },
});

export const setPrimerTool = defineTool({
  name: "set_primer",
  title: "Update deck primer",
  description: [
    "Updates a deck's Markdown primer, either patching a single `## Section` heading or replacing the full primer when `section` is omitted. Supports `[[Card Name]]` links.",
    "Use it when: writing or updating a section (e.g. Plan, How it wins, Key cards, Mulligan, Turns 1–3, Watch out for).",
  ].join("\n"),
  scope: "decks:write",
  readOnly: false,
  input: z.object({
    deckId,
    section: z
      .string()
      .min(1)
      .max(80)
      .optional()
      .describe(
        "Optional ## heading name to patch in place, or to add at the end (omit to replace the entire primer).",
      ),
    content: z
      .string()
      .max(20000)
      .describe(
        'Markdown for the section (without its "## " heading) or for the full primer; "" removes the section (or clears the primer).',
      ),
  }),
  async run(context, input) {
    const updated = await updateDeckPrimer(
      context.container.db,
      context.actor.userId,
      input.deckId,
      { section: input.section, content: input.content },
      context.container.clock.now(),
    );
    if (!updated) return deckNotFound(input.deckId);

    const warnings: string[] = [];
    const linkMatches = [...updated.primer.matchAll(/\[\[([^\]]+)\]\]/g)]
      .map((m) => m[1]?.trim() ?? "")
      .filter((name) => name.length > 0);
    const uniqueLinks = [...new Set(linkMatches)];
    if (uniqueLinks.length > 0) {
      const view = await viewFor(context, input.deckId);
      const deckNames = new Set(
        (view?.lines ?? []).flatMap((l) => [
          l.name.toLowerCase(),
          ...l.name.split(" // ").map((f) => f.toLowerCase()),
        ]),
      );
      const missingFromDeck = uniqueLinks.filter((name) => !deckNames.has(name.toLowerCase()));
      if (missingFromDeck.length > 0) {
        const resolved = await Promise.all(
          missingFromDeck.map(
            async (name) => [name, await findCard(context.container.db, name)] as const,
          ),
        );
        for (const [name, found] of resolved) {
          if (!found) {
            warnings.push(`[[${name}]] in primer was not found in the card catalog.`);
          } else if (!deckNames.has(found.name.toLowerCase())) {
            warnings.push(`[[${found.name}]] in primer is not currently in this deck.`);
          }
        }
      }
    }

    return done({
      deckId: updated.deckId,
      primerSections: primerSections(updated.primer),
      characters: updated.primer.length,
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  },
});
