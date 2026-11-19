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
  combosForDeck,
  bracketWarning,
  checkNote,
  checkOwnedCards,
  CORE_DECK_TAGS,
  deckChangePreview,
  deckProblems,
  deckStats,
  deckText,
  deckTokenLines,
  deckView,
  DeckId,
  estimateBracket,
  decksFor,
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
  COST_REDUCER_SCOPES,
  type DeckPlanProfile,
  isAvoidCard,
  isKeyCard,
  listDeckSources,
  manaBasePlan,
  MAX_HEADING_LENGTH,
  MAX_HEADINGS,
  MAX_NOTE_LENGTH,
  MAX_ROLE_LENGTH,
  MAX_QUANTITY,
  openingHandOdds,
  roleTargets,
  shortList,
  summarizeTokenChecklist,
  toTokenChecklistItem,
  type DeckChange,
  type DeckChangePreview,
  type DeckCombo,
  type DeckProblem,
  type DeckLine,
  type DeckView,
} from "@/modules/decks";
import { cardTags } from "@/shared/card-search";
import { deckProfileFor } from "../avoid-cards";
import { MAX_TOOL_RESPONSE_BYTES } from "../cap-response";
import { groupCompactLines, pageCompactGroups } from "../compact-deck";
import {
  bracketWarningText,
  estimateLabel,
  findingWithCards,
  landReasonText,
  landTargetReasonText,
  problemText,
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
  tag: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Optional user-assigned tag filter for lines (e.g. "Blitz"); does not match auto-detected role tags.',
    ),
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
    const [fullPayload, profile] = await Promise.all([
      fullDeckPayload(
        context,
        input.view === "full" ? input : { ...input, fields: undefined },
        view,
      ),
      deckProfileFor(context, input.deckId),
    ]);
    if (profile) {
      const baseTargets = roleTargets(view.deck.format);
      if (baseTargets !== null) {
        fullPayload.roleTargets =
          resolveDeckProfileTargets(profile, null, {
            landTarget: 37,
            roleTargets: baseTargets,
          })?.roleTargets ?? baseTargets;
      }
    }
    if (input.view === "full") return done(fullPayload);
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
    targetBracket: z
      .number()
      .int()
      .min(1)
      .max(5)
      .optional()
      .describe("Optional Commander bracket target (1–5)."),
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
    if (input.targetBracket !== undefined) {
      await decks.updateDeck(context.actor, {
        deckId: created.value,
        targetBracket: input.targetBracket as 1 | 2 | 3 | 4 | 5,
      });
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

export const deleteDeckTool = defineTool({
  name: "delete_deck",
  title: "Delete a deck",
  description: [
    "Permanently deletes a deck and all of its entries, sources, and snapshots. Requires confirm: true.",
    "Use it when: cleaning up an old or duplicate test deck after the user asks to remove it.",
  ].join("\n"),
  scope: "decks:write",
  readOnly: false,
  input: z.object({
    deckId,
    confirm: z.boolean().default(false).describe("Must be true to permanently delete the deck."),
  }),
  async run(context, input) {
    if (!input.confirm) {
      return failed("ConfirmationRequired", "Pass confirm: true to permanently delete this deck.");
    }
    const result = await context.container.decks.deleteDeck(context.actor, DeckId.of(input.deckId));
    if (!result.ok) return deckNotFound(input.deckId);
    return done({ deckId: input.deckId, deleted: true });
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

const roundTwo = (value: number) => Math.round(value * 100) / 100;

function summarizeRemainingProblems(problems: readonly DeckProblem[]): string[] {
  const nonShort = problems.filter((p) => p.kind !== "Short").map(problemText);
  const shortCount = problems.length - nonShort.length;
  if (shortCount <= 5) return problems.map(problemText);
  return [...nonShort, `${shortCount} short card(s) (see shortTotal / deck_facts)`];
}

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
      remaining: summarizeRemainingProblems(preview.problems.remaining),
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
    const [view, storedProfile] = await Promise.all([
      deckView(context.container.db, context.actor.userId, input.deckId),
      getDeckProfile(context.container.db, context.actor.userId, input.deckId),
    ]);
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

    const leftOutAvoid: string[] = [];
    const notInDeckCandidates = data.cards.filter((card) => {
      const lower = card.name.toLowerCase();
      const front = lower.split(" // ")[0] ?? lower;
      if (deckCardKeys.has(lower) || deckCardKeys.has(front)) return false;
      if (isAvoidCard(card.name, storedProfile?.profile)) {
        leftOutAvoid.push(card.name);
        return false;
      }
      return true;
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
      ...(leftOutAvoid.length > 0 ? { leftOutAvoid: [...new Set(leftOutAvoid)].sort() } : {}),
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

const costReducerSchema = z.object({
  cardName: z.string().min(1),
  scope: z.enum(COST_REDUCER_SCOPES),
  genericReduction: z.number().int().min(0).max(20),
  perCommandCast: z.boolean().optional(),
  minManaValue: z
    .number()
    .int()
    .min(0)
    .max(20)
    .optional()
    .describe("Optional minimum base mana value required (e.g. 4 for Henzie)."),
  minPower: z
    .number()
    .int()
    .min(0)
    .max(20)
    .optional()
    .describe("Optional minimum creature power required (e.g. 4 for Goreclaw)."),
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
        'Declarative cost reducers (e.g. Henzie: scope "creatures", minManaValue 4, genericReduction 1, perCommandCast true; Goreclaw: scope "creatures", minPower 4, genericReduction 2; Electromancer: scope "instants_sorceries", genericReduction 1).',
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
