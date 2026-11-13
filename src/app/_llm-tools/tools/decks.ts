import { z } from "zod";
import { PrintingId } from "@/modules/catalog";
import {
  auditDeck,
  BOARDS,
  bracketLine,
  bracketRuleReasons,
  COMMANDER_SORTS,
  commanderDetails,
  commandersICanBuild,
  combosForDeck,
  bracketWarning,
  chanceByTurn,
  checkNote,
  compareDeckSnapshot,
  deckChangePreview,
  deckProblems,
  deckProfile,
  deckSignalProfile,
  deckStats,
  deckSuggestions,
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
  GROUPINGS,
  isLand,
  legalFormatsForCards,
  library,
  listDeckSnapshots,
  manaBasePlan,
  MAX_HEADING_LENGTH,
  MAX_HEADINGS,
  MAX_NOTE_LENGTH,
  MAX_QUANTITY,
  MAX_SNAPSHOT_LABEL_LENGTH,
  MAX_SNAPSHOTS_PER_DECK,
  openingHandOdds,
  optimizeDeckForView,
  rankCuts,
  rateCard,
  roleTargets,
  SnapshotId,
  SPELL_SLOTS,
  shortList,
  simulateOpeningHands,
  suggestSwaps,
  summarizeTokenChecklist,
  TOKEN_KINDS,
  toTokenChecklistItem,
  type CommanderCoverage,
  type DeckChange,
  type DeckChangePreview,
  type DeckCombo,
  type DeckProblem,
  type DeckView,
  type SnapshotComparison,
  type SwapCutMeta,
} from "@/modules/decks";
import { cardTags, cardThemes, canonicalTheme, TAGS, THEMES } from "@/shared/card-search";
import { seededRng } from "@/shared/kernel";
import {
  bracketWarningText,
  cutReasonText,
  draftReasonText,
  swapReasonText,
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

/** The most cut candidates rank_cuts returns at once. */
const MAX_CUTS = 30;

export const rankCutsTool = defineTool({
  name: "rank_cuts",
  title: "Possible cuts for a deck",
  description: [
    "Ideas for what a deck could cut: the main-deck cards that score lowest on a few simple checks, lowest first, each with a rough keep score and the reasons in words (matches none of the themes the app found, a role the deck has more of than its target, expensive in a high curve, over the target bracket, not owned; reasons a card scored higher are listed too). Lands and commanders aren't ranked.",
    "Use it when: the deck is over its size, or the player asks what to cut. It's a starting point, not a verdict: the checks read rules text with fixed patterns, so they miss combos, synergies they have no rule for, and the player's plan. Judge each card by its text (get_deck with includeText) and present cuts as options with your reasons.",
    'Rules: suggest cuts, don\'t make them unasked; the player decides. To set a card aside, move it to the maybeboard with set_deck_entry (0 on "main", then the same count on "maybe").',
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({
    deckId,
    count: z
      .number()
      .int()
      .min(1)
      .max(MAX_CUTS)
      .default(10)
      .describe(`How many cards to return, lowest score first (1 to ${MAX_CUTS}).`),
  }),
  async run(context, input) {
    const view = await viewFor(context, input.deckId);
    if (view === null) return deckNotFound(input.deckId);
    const cuts = rankCuts(view.lines, {
      format: view.deck.format,
      targetBracket: view.deck.targetBracket,
    });
    return done({
      deck: { id: view.deck.id, name: view.deck.name, format: view.deck.format },
      cuts: cuts.slice(0, input.count).map((cut) => ({
        name: cut.name,
        keepScore: Math.round(cut.keepScore * 10) / 10,
        why: cut.reasons.map(cutReasonText),
      })),
      candidates: cuts.length,
    });
  },
});

const MAX_SWAPS = 15;

export const suggestSwapsTool = defineTool({
  name: "suggest_swaps",
  title: "Suggest one-step card swaps for a deck",
  description: [
    "Pairs the deck's weakest main-deck cards (from rank_cuts) with top-rated replacements (owned or store), checking Commander singleton rules and target-bracket limits.",
    "Use it when: the player asks what to swap out and what to put in.",
    "Rules: suggest swaps, don't apply them unasked; preview with apply_changes (save: false) before saving.",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({
    deckId,
    pool: z
      .enum(["owned", "store"])
      .default("owned")
      .describe("Where to draw replacement candidates from."),
    count: z
      .number()
      .int()
      .min(1)
      .max(MAX_SWAPS)
      .default(5)
      .describe(`How many swaps to return (1 to ${MAX_SWAPS}).`),
  }),
  async run(context, input) {
    const [view, suggestions] = await Promise.all([
      viewFor(context, input.deckId),
      deckSuggestions(context.container.db, context.actor.userId, input.deckId),
    ]);
    if (view === null) return deckNotFound(input.deckId);

    const cuts = rankCuts(view.lines, {
      format: view.deck.format,
      targetBracket: view.deck.targetBracket,
    });
    const profile = deckProfile(view.lines, view.deck.format);
    const stats = deckStats(view.lines);
    const ratingProfile = {
      format: view.deck.format,
      themes: profile.themes,
      tribes: profile.tribes,
      gaps: profile.gaps,
      keywords: profile.keywords,
      signals: profile.signals ?? deckSignalProfile([]),
      averageManaValue: profile.averageManaValue ?? stats.averageManaValue,
      curveCounts: profile.curveCounts ?? new Map(),
    };

    const cutMeta = new Map<string, SwapCutMeta>();
    const existingOracleIds = new Set<string>();
    for (const line of view.lines) {
      existingOracleIds.add(line.oracleId);
      if (line.board !== "main" || isLand(line.typeLine)) continue;
      if (cutMeta.has(line.oracleId)) continue;
      const facts = { typeLine: line.typeLine, text: line.text, producedMana: line.producedMana };
      const r = rateCard(
        {
          oracleId: line.oracleId,
          name: line.name,
          typeLine: line.typeLine,
          manaValue: line.manaValue,
          text: line.text,
          keywords: line.keywords,
          roles: cardTags(facts),
          themes: cardThemes(facts),
          rarity: line.rarity,
          priceCents: line.priceCents,
          isGameChanger: line.isGameChanger,
        },
        ratingProfile,
        { targetBracket: view.deck.targetBracket },
      );
      cutMeta.set(line.oracleId, {
        manaValue: line.manaValue,
        rating: r.rating,
        isBasicLand: line.typeLine.includes("Basic Land"),
      });
    }

    const poolItems = suggestions?.forDeck[input.pool] ?? [];
    const candidates = poolItems.map((s) => ({
      card: {
        oracleId: s.card.oracleId,
        name: s.card.name,
        typeLine: s.card.typeLine,
        manaValue: s.card.manaValue,
        keywords: s.card.keywords,
        roles: s.card.roles,
        themes: s.card.themes,
        rarity: s.card.rarity,
        priceCents: s.card.priceCents,
        pool: s.card.pool,
        edhrecRank: s.card.edhrecRank,
        edhrec: s.card.edhrec,
      },
      score: s.rating,
      reasons: s.reasons,
      rating: { rating: s.rating, logit: 0, parts: s.ratingParts },
    }));

    const neededRoles = new Set(profile.gaps.map((g) => g.tag));
    const swaps = suggestSwaps(cuts, cutMeta, candidates, {
      format: view.deck.format,
      targetBracket: view.deck.targetBracket,
      existingOracleIds,
      neededRoles,
      limit: input.count,
    });

    return done({
      deck: { id: view.deck.id, name: view.deck.name, format: view.deck.format },
      swaps: swaps.map((s) => ({
        cut: { name: s.cut.name, oracleId: s.cut.oracleId },
        add: {
          name: s.add.card.name,
          oracleId: s.add.card.oracleId,
          rating: s.add.rating?.rating ?? null,
        },
        netGain: s.netGain,
        why: s.reasons.map(swapReasonText),
      })),
    });
  },
});

export const optimizeDeckTool = defineTool({
  name: "optimize_deck",
  title: "Optimize a deck via multi-card Simulated Annealing",
  description: [
    "Runs a Simulated Annealing local search over the deck's non-land mainboard slots to find multi-card swaps that maximize the whole-deck objective (card quality, role coverage, mana curve, color balance, synergy cohesion, bracket compliance, and optional budget cap).",
    "Use it when: the player asks to optimize or tune a deck as a whole rather than one card at a time.",
    "Rules: read-only preview — does not mutate the deck; preview/apply accepted swaps with apply_changes.",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({
    deckId,
    pool: z
      .enum(["owned", "store", "both"])
      .default("owned")
      .describe("Candidate pool to optimize from: owned cards, store cards, or both."),
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
      .describe("Optional deterministic RNG seed for reproducible optimization runs."),
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
      deck: {
        id: deck.id,
        name: deck.name,
        format: deck.format,
        targetBracket: deck.targetBracket,
      },
      before: result.before,
      after: result.after,
      delta: result.delta,
      iterationsRun: result.iterationsRun,
      acceptedMoves: result.acceptedMoves,
      improvedMoves: result.improvedMoves,
      swaps: result.swaps.map((s) => ({
        cut: { name: s.cut.name, oracleId: s.cut.oracleId, manaValue: s.cut.manaValue },
        add: {
          name: s.add.name,
          oracleId: s.add.oracleId,
          manaValue: s.add.manaValue,
          pool: s.add.pool ?? "owned",
          priceCents: s.priceCents,
        },
        netCardRatingGain: s.netCardRatingGain,
      })),
    });
  },
});

export const planManaBaseTool = defineTool({
  name: "plan_mana_base",
  title: "Plan a deck's mana base",
  description: [
    "A mana base you could start from: a land count for the deck (the usual count, moved by its curve and its other mana sources, with reasons), how many sources of each of its colors to aim for and how many it has, then lands to add to reach the count: lands the player owns first (any copy: decks share cards, so a land in another deck counts, with a note where else it's played), picked for the colors the deck is short of, untapped first, plus owned lands that do something the deck needs; basics fill the rest. Also up to five store lands to consider buying, with prices; these are never in the lands to add.",
    "Use it when: building a deck, after the spells are chosen, or when the player asks about lands or colors. It's a starting point from rules of thumb, not the best mana base: check the lands against the deck and present them as options.",
    'Rules: it only adds lands, never cuts them ("over" says how many lands the deck has beyond the target). Add the lands the player agrees to with set_deck_entry; suggest store lands, or add them to the wishlist with add_wish, never buy.',
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

export const getDeck = defineTool({
  name: "get_deck",
  title: "Get a deck",
  description: [
    "One deck in full: every card with how many you own, the deck's statistics (mana curve, colors, types, role counts against the format's targets), what's wrong with it (short cards, size, legality, color identity), its Commander bracket, its list as text, and its fingerprint.",
    "Use it when: starting work on a deck (read the commander's text first), before replace_deck_list (pass its fingerprint), and to check your changes.",
    'Returns: lines (board, quantity, owned, isGameChanger; "owned < quantity" means short; free and otherDecks when another of your decks also uses the card), stats (including sideboardCount), formatRules (minMainCards, exactSize, maxCopies, maxSideboard), cardLegalIn (for 60-card decks: Standard/Pioneer/Modern/Legacy/Vintage/Pauper where its current cards and copy counts are legal), roleTargets (Commander and 60-card formats: ramp, draw, removal, wipe; null for Limited), problems in words, bracket (commander decks: the target the player chose, the lowest bracket the cards allow and why, and overTarget when the cards go over the target), tokens (summary counts and checklist of tokens, emblems, and helper cards created by counted cards; use deck_tokens for full rules text and art), list (the text replace_deck_list takes), shortList (the missing cards as a list).',
    'Rules: decks may hold cards you don\'t own; they show as short. Basic lands are never short. Your decks share the copies you own: free is how many no other deck uses, and otherDecks lists the decks holding the rest (deckId, name, quantity). Lines on the "maybe" board (the maybeboard) are cards being considered: they count in nothing (size, stats, problems, bracket, short).',
    'Headings & notes: the player may group the main deck under headings of their own ("Ramp", "Win conditions"): a line\'s heading, the deck\'s headings in order, and grouping ("custom" when the deck is shown by them, "type" when by card type). Cards may also carry a short `note` explaining why they are in the deck. Change them with set_deck_entry, apply_changes, and arrange_headings.',
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({
    deckId,
    includeText: z
      .boolean()
      .default(true)
      .describe("Include each card's rules text. Set false to save space on big decks."),
  }),
  async run(context, input) {
    const view = await viewFor(context, input.deckId);
    if (view === null) return deckNotFound(input.deckId);
    const problems = problemsOf(view);
    const stats = deckStats(view.lines);
    const { list, fingerprint: print } = listAndFingerprint(view);
    const handOdds = openingHandOdds(library(view.lines), {
      onTheDraw: false,
      freeMulligan: view.deck.format === "commander",
    });
    const toPercent = (probability: number) => Math.round(probability * 1000) / 10;
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
    const checklist = rawTokens.map(toTokenChecklistItem);
    return done({
      deck: {
        id: view.deck.id,
        name: view.deck.name,
        format: view.deck.format,
        usesRealCards: view.deck.usesRealCards,
        grouping: view.deck.grouping,
        headings: view.deck.headings,
      },
      fingerprint: print,
      lines: view.lines.map((line) => ({
        name: line.name,
        oracleId: line.oracleId,
        printingId: line.printingId,
        board: line.board,
        quantity: line.quantity,
        ...(line.heading !== null ? { heading: line.heading } : {}),
        ...(line.note !== null ? { note: line.note } : {}),
        owned: line.owned,
        ...(line.otherDecks.length > 0
          ? {
              free: line.free,
              otherDecks: line.otherDecks.map((use) => ({
                deckId: use.deckId,
                name: use.name,
                quantity: use.quantity,
              })),
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
    });
  },
});

export const createDeck = defineTool({
  name: "create_deck",
  title: "Create a deck",
  description: [
    "Makes a new, empty deck and returns its id. Optionally fills it from a list in the usual text format.",
    'Use it when: the player wants a new deck. Then add cards with set_deck_entry, or pass a whole list here ("Commander" / "Deck" / "Sideboard" / "Maybeboard" headings, or headings of the player\'s own such as "Ramp (2)", then lines like "1 Sol Ring").',
    "Rules: cards you don't own may be added; they show as short.",
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
    "Target bracket (Commander decks only): the Commander bracket the player means the deck for, 1–5 (1 Exhibition, 2 Core, 3 Upgraded, 4 Optimized, 5 cEDH), or 0 for none. With one, get_deck warns when the cards go over it, and suggest_for_deck, similar_cards, budget_upgrades and search_for_deck leave out cards that would. Changing the format away from Commander clears it.",
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
    roles: preview.roles.map((role) => ({
      role: role.tag,
      label: TAG_LABELS[role.tag],
      before: role.before,
      after: role.after,
      target: role.target,
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

export const applyChangesTool = defineTool({
  name: "apply_changes",
  title: "Preview or apply a batch of changes to a deck",
  description: [
    "Pre-evaluates (and optionally saves) a batch of card count changes to a deck: returns before/after for card count, curve, average mana value, roles vs targets, colors, Commander bracket, problems added/resolved/remaining, newly short cards, price difference, and the deck's fingerprint. Each change sets the card's count on a board (0 removes it).",
    "Use it when: testing swaps, cuts or additions before changing the player's deck, or applying multiple changes at once. Leave save false (the default) to preview first, show the player the differences, and save only what they agreed to by calling again with save true and the preview's fingerprint.",
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
            .describe("How many copies the deck should have on this board; 0 removes the card."),
          board,
          note: z
            .string()
            .max(400)
            .optional()
            .describe(
              `Optional note explaining why this card is in the deck (up to ${MAX_NOTE_LENGTH} chars); "" clears it.`,
            ),
        }),
      )
      .min(1)
      .max(100)
      .describe("Count changes to preview or save (1 to 100 entries)."),
    save: z
      .boolean()
      .default(false)
      .describe(
        "False (the default) previews without saving; true saves all changes if fingerprint matches.",
      ),
    fingerprint: z
      .string()
      .optional()
      .describe("Required when save is true: the fingerprint from get_deck or a preview."),
  }),
  async run(context, input) {
    const saveFingerprint = input.fingerprint ?? "";
    if (input.save && saveFingerprint === "") {
      return failed(
        "InputInvalid",
        "Pass the fingerprint from get_deck or a prior preview when save is true.",
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
      if (entry.quantity > 0 && entry.note !== undefined && entry.note !== "") {
        const checked = checkNote(entry.note);
        if (!checked.ok) {
          return failed(
            "NoteInvalid",
            `Line note for ${entry.card} must be 1 to ${checked.error.maximum} characters (or "" to clear).`,
          );
        }
      }
    }

    const resolvedChanges: DeckChange[] = [];
    const changesToSave: Array<DeckChange & { note?: string | null }> = [];
    for (const entry of input.changes) {
      const oracleId = byName.get(entry.card);
      if (oracleId === undefined) continue;
      resolvedChanges.push({ oracleId, board: entry.board, quantity: entry.quantity });
      changesToSave.push({
        oracleId,
        board: entry.board,
        quantity: entry.quantity,
        ...(entry.note !== undefined && entry.quantity > 0
          ? { note: entry.note === "" ? null : entry.note }
          : {}),
      });
    }

    const preview = await deckChangePreview(
      context.container.db,
      context.actor.userId,
      input.deckId,
      resolvedChanges,
    );
    if (preview === null) return deckNotFound(input.deckId);

    if (!input.save) {
      return done(
        formatPreviewResponse(preview, { saved: false, fingerprint: preview.fingerprint }),
      );
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
      }
    }

    return done(
      formatPreviewResponse(preview, { saved: true, fingerprint: result.value.fingerprint }),
    );
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

export const auditDeckTool = defineTool({
  name: "audit_deck",
  title: "One-shot deck health audit",
  description: [
    "Runs a comprehensive read-only health check on a deck in one call: legality problems, Commander bracket & two-card combos, whole-deck objective score, role counts vs. targets, mana/color balance, ownership gaps, top 5 weakest cut candidates, 500-hand London-mulligan goldfish summary, and prioritized findings.",
    "Use it when: starting a deck review or checking overall deck health before making targeted edits.",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({ deckId }),
  async run(context, input) {
    const report = await auditDeck(context.container.db, context.actor.userId, input.deckId);
    if (report === null) return deckNotFound(input.deckId);
    return done(report);
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
  }),
  async run(context, input) {
    const view = await viewFor(context, input.deckId);
    if (view === null) return deckNotFound(input.deckId);
    const cards = library(view.lines);
    const freeMulligan = input.freeMulligan ?? view.deck.format === "commander";
    const report = simulateOpeningHands(cards, {
      rng: seededRng(input.seed ?? `sim-${view.deck.id}`),
      trials: input.trials,
      minLands: input.minLands,
      maxLands: input.maxLands,
      requireEarlyPlay: input.requireEarlyPlay,
      freeMulligan,
      onTheDraw: input.onTheDraw,
    });
    return done({
      deckId: view.deck.id,
      deckName: view.deck.name,
      freeMulligan,
      onTheDraw: input.onTheDraw,
      ...report,
    });
  },
});

export const upgradeRoadmapTool = defineTool({
  name: "upgrade_roadmap",
  title: "Tiered cut/add upgrade roadmap",
  description: [
    "Builds a cumulative tiered upgrade plan across budget milestones (default $25 / $75 / $200), pairing weakest main-deck cuts with bracket-compliant store upgrades and scoring each milestone.",
    "Use it when: the player asks for a phased upgrade path ('how should I upgrade this deck over $25, $75, and $200?'). Read-only.",
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
      .describe("Maximum number of cut/add swaps per tier (1 to 10, default 5)."),
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
      deckId: result.deck.id,
      deckName: result.deck.name,
      baseScore: result.roadmap.baseScore,
      hiddenOverTarget: result.hiddenOverTarget,
      tiers: result.roadmap.tiers.map((tier) => ({
        tierBudget: money(tier.tierBudgetCents),
        tierSpent: money(tier.tierSpentCents),
        cumulativeBudget: money(tier.cumulativeBudgetCents),
        cumulativeSpent: money(tier.cumulativeSpentCents),
        scoreAfter: tier.scoreAfter,
        scoreDeltaFromBase: tier.scoreDeltaFromBase,
        swaps: tier.swaps.map((swap) => ({
          cut: swap.cut.name,
          cutKeepScore: swap.cut.keepScore,
          add: swap.add.card.name,
          addPrice: money(swap.priceCents),
          addRating: swap.add.rating,
          reasons: swap.add.reasons,
        })),
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
