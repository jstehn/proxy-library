import { formatRules } from "../../domain/format-rules";
import {
  err,
  ok,
  seededRng,
  type Clock,
  type Result,
  type UserId,
  type CardFacts,
} from "@/shared/kernel";
import { commanderOnlyProfile, effectiveManaValue, type DeckPlan } from "../../domain/deck-profile";
import type { DeckLine, DeckView } from "../../domain/deck-view";
import { parseCost } from "../../domain/mana-payment";
import { COMMANDER_KEEP, dealHand, MAX_MULLIGANS } from "../domain/opening-hand/hand";
import { library, OPENING_HAND } from "../domain/opening-hand/library";
import type { DeckNotFound } from "../../domain/errors";
import { simulateOpeningHands } from "../domain/goldfish";
import { simulateCasting, type CastCurve, type CastTarget } from "../domain/cast-by-turn";
import type { CardFeatures } from "@/modules/catalog";

// A few shuffled opening hands from a deck, the odds of a good start over many trials, and the
// chance of casting a card by each turn: the one capability behind `draw_sample` and the builder.

/** The deck lines with what the catalog's card features say about mana (ramp, tapped lands). */
export type CastDeckView = Omit<DeckView, "lines"> &
  Readonly<{
    lines: readonly (DeckLine &
      Partial<Pick<CardFeatures, "tapMana" | "entersTapped" | "landFetch">>)[];
  }>;

export type DrawSampleReaders = Readonly<{
  deckView(userId: UserId, deckId: number): Promise<CastDeckView | null>;
  profile(userId: UserId, deckId: number): Promise<DeckPlan | null>;
  clock: Clock;
}>;

/** What to cast: a card name, or this word for the deck's commander. */
export const COMMANDER_WORD = "commander";

export type CastRequest = Readonly<{
  userId: UserId;
  deckId: number;
  /** Card names, or "commander" for the deck's commander. */
  cards: readonly string[];
  onTheDraw: boolean;
  /** The last turn of the curve (1 to 10). */
  lastTurn: number;
  runs: number;
  seed?: string;
}>;

export type DrawSampleRequest = Readonly<{
  userId: UserId;
  deckId: number;
  hands: number;
  drawNext: number;
  trials: number;
  /** Cards to give the cast-by-turn curve for; none leaves it out. */
  cast?: readonly string[];
  onTheDraw?: boolean;
  lastTurn?: number;
  seed?: string;
}>;

export type SampleCard = Readonly<Pick<CardFacts, "name" | "typeLine"> & { manaCost: string }>;

/** The measured chance of casting each card by each turn, cumulative. */
export type CastReport = Readonly<{
  runs: number;
  /** Half the 95% interval, in percentage points, worst case. */
  marginPct: number;
  onTheDraw: boolean;
  cards: readonly Readonly<{
    card: string;
    /** Percent chance of having cast it by turn 1, 2, … */
    byTurnPct: readonly number[];
    medianTurn: number | null;
    /** Why the runs that failed by the last turn did, e.g. "not drawn 12%". */
    misses: string;
  }>[];
}>;

export type DrawSample = Readonly<{
  deckId: number;
  samples: readonly Readonly<{ hand: SampleCard[]; nextDraws: SampleCard[] }>[];
  odds: Readonly<{
    trials: number;
    keepablePct: number;
    turn3LandPct: number;
    earlyRampPct: number;
  }>;
  cast?: CastReport;
}>;

export type DeckTooSmall = Readonly<{ kind: "DeckTooSmall"; minimum: number }>;
export type CastCardNotInDeck = Readonly<{ kind: "CastCardNotInDeck"; name: string }>;
export type CastFailure = DeckNotFound | DeckTooSmall | CastCardNotInDeck;

const MISS_WORDS = { notDrawn: "not drawn", tooLittleMana: "too little mana" } as const;

export function makeDrawSample(readers: DrawSampleReaders) {
  async function drawSample(request: DrawSampleRequest): Promise<Result<DrawSample, CastFailure>> {
    const { userId, deckId } = request;
    const view = await readers.deckView(userId, deckId);
    if (view === null) return err({ kind: "DeckNotFound" });

    const cards = library(view.lines);
    if (cards.length < OPENING_HAND) return err({ kind: "DeckTooSmall", minimum: OPENING_HAND });

    const lineByOracle = new Map(view.lines.map((line) => [line.oracleId, line]));
    const rng = seededRng(request.seed ?? `${deckId}:${readers.clock.now().getTime()}`);
    const compact = (card: (typeof cards)[number]): SampleCard => {
      const line = lineByOracle.get(card.oracleId);
      return { name: card.name, manaCost: line?.manaCost ?? "", typeLine: line?.typeLine ?? "" };
    };

    const freeMulligan = formatRules(view.deck.format).freeFirstMulligan;
    const samples: { hand: SampleCard[]; nextDraws: SampleCard[] }[] = [];
    for (let handNumber = 0; handNumber < request.hands; handNumber++) {
      const dealt = dealHand(cards, rng, freeMulligan);
      samples.push({
        hand: dealt.hand.map(compact),
        nextDraws: dealt.library.slice(0, request.drawNext).map(compact),
      });
    }

    const sim = simulateOpeningHands(cards, {
      rng: seededRng(request.seed ?? `sim-${view.deck.id}`),
      trials: request.trials,
      freeMulligan,
    });
    const odds = {
      trials: sim.trials,
      keepablePct: sim.keepableRatePct,
      turn3LandPct: sim.turn3LandDropPct,
      earlyRampPct: sim.earlyRampInHandPct,
    };
    if (request.cast === undefined) return ok({ deckId, samples, odds });

    const cast = await castCurves({
      userId,
      deckId,
      cards: request.cast,
      onTheDraw: request.onTheDraw ?? false,
      lastTurn: request.lastTurn ?? 10,
      runs: request.trials,
      ...(request.seed !== undefined ? { seed: request.seed } : {}),
    });
    return cast.ok ? ok({ deckId, samples, odds, cast: cast.value }) : cast;
  }

  /** "What is the chance I can cast these cards by turn 1, 2, …?" (bootstrapped from seeded runs). */
  async function castCurves(request: CastRequest): Promise<Result<CastReport, CastFailure>> {
    const [view, profile] = await Promise.all([
      readers.deckView(request.userId, request.deckId),
      readers.profile(request.userId, request.deckId),
    ]);
    if (view === null) return err({ kind: "DeckNotFound" });
    const cards = library(view.lines);
    if (cards.length < OPENING_HAND) return err({ kind: "DeckTooSmall", minimum: OPENING_HAND });

    const targets: CastTarget[] = [];
    for (const name of request.cards) {
      const target = castTarget(view, profile, name);
      if (target === undefined) return err({ kind: "CastCardNotInDeck", name });
      targets.push(target);
    }
    const rule = {
      policy: COMMANDER_KEEP,
      freeMulligan: formatRules(view.deck.format).freeFirstMulligan,
      maxMulligans: MAX_MULLIGANS,
    };
    const simulation = simulateCasting(cards, targets, {
      rng: seededRng(request.seed ?? `cast-${request.deckId}`),
      runs: request.runs,
      onTheDraw: request.onTheDraw,
      lastTurn: request.lastTurn,
      rule,
    });
    return ok({
      runs: simulation.runs,
      marginPct: Math.round(simulation.marginOfError * 1000) / 10,
      onTheDraw: request.onTheDraw,
      cards: simulation.curves.map(describeCurve),
    });
  }

  return { drawSample, castCurves };
}

function describeCurve(curve: CastCurve): CastReport["cards"][number] {
  const words = curve.misses
    .filter((miss) => miss.share >= 0.01)
    .slice(0, 3)
    .map((miss) => {
      const reason =
        miss.reason in MISS_WORDS
          ? MISS_WORDS[miss.reason as keyof typeof MISS_WORDS]
          : `no ${miss.reason.split(":")[1]} source`;
      return `${reason} ${Math.round(miss.share * 100)}%`;
    });
  return {
    card: curve.name,
    byTurnPct: curve.byTurn.map((chance) => Math.round(chance * 100)),
    medianTurn: curve.medianTurn,
    misses: words.join(", "),
  };
}

/** The card to cast (or the commander), with cost reducers the deck declares counted. */
function castTarget(
  view: CastDeckView,
  profile: DeckPlan | null,
  name: string,
): CastTarget | undefined {
  const wanted = name.trim().toLowerCase();
  const line =
    wanted === COMMANDER_WORD
      ? view.lines.find((candidate) => candidate.board === "commander")
      : view.lines.find((candidate) => candidate.name.toLowerCase() === wanted);
  if (line === undefined) return undefined;
  const commanderNames = view.lines.filter((l) => l.board === "commander").map((l) => l.name);
  const manaValue = effectiveManaValue(
    line.manaValue ?? 0,
    {
      typeLine: line.typeLine,
      manaCost: line.manaCost,
      isBlitz: line.keywords.includes("Blitz"),
      isCommander: line.board === "commander",
    },
    commanderOnlyProfile(profile ?? undefined, commanderNames),
    0,
  );
  return {
    name: line.name,
    typeLine: line.typeLine,
    manaValue,
    pips: parseCost(line.manaCost).pips,
    mustDraw: line.board !== "commander",
  };
}
