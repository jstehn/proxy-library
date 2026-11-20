import { formatRules } from "../domain/format-rules";
import {
  err,
  ok,
  seededRng,
  type Clock,
  type Result,
  type UserId,
  type CardFacts,
} from "@/shared/kernel";
import { commanderOnlyProfile, effectiveManaValue, type DeckPlan } from "../domain/deck-profile";
import type { DeckView } from "../domain/deck-view";
import { parseCost } from "../domain/mana-payment";
import { dealHand } from "../domain/opening-hand/hand";
import { library, OPENING_HAND } from "../domain/opening-hand/library";
import type { DeckNotFound } from "../domain/errors";
import { simulateOpeningHands, type MustCastByOption } from "../domain/goldfish";

// A few shuffled opening hands from a deck, and the odds of a good start over many trials.

export type DrawSampleReaders = Readonly<{
  deckView(userId: UserId, deckId: number): Promise<DeckView | null>;
  profile(userId: UserId, deckId: number): Promise<DeckPlan | null>;
  clock: Clock;
}>;

export type DrawSampleRequest = Readonly<{
  userId: UserId;
  deckId: number;
  hands: number;
  drawNext: number;
  trials: number;
  /** A card that should be castable by `mustCastTurn` (the commander when left out). */
  mustCastCard?: string;
  mustCastTurn?: number;
  seed?: string;
}>;

export type SampleCard = Readonly<Pick<CardFacts, "name" | "typeLine"> & { manaCost: string }>;

export type DrawSample = Readonly<{
  deckId: number;
  samples: readonly Readonly<{ hand: SampleCard[]; nextDraws: SampleCard[] }>[];
  odds: Readonly<{
    trials: number;
    keepablePct: number;
    turn3LandPct: number;
    earlyRampPct: number;
    mustCastBy?: Readonly<{
      card: string;
      turn: number;
      effectiveManaValue: number;
      castablePct: number;
    }>;
  }>;
}>;

export type DeckTooSmall = Readonly<{ kind: "DeckTooSmall"; minimum: number }>;

export function makeDrawSample(readers: DrawSampleReaders) {
  async function drawSample(
    request: DrawSampleRequest,
  ): Promise<Result<DrawSample, DeckNotFound | DeckTooSmall>> {
    const { userId, deckId } = request;
    const [view, profile] = await Promise.all([
      readers.deckView(userId, deckId),
      readers.profile(userId, deckId),
    ]);
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

    const mustCastBy = mustCastOption(view, profile, request);
    const sim = simulateOpeningHands(cards, {
      rng: seededRng(request.seed ?? `sim-${view.deck.id}`),
      trials: request.trials,
      freeMulligan,
      ...(mustCastBy ? { mustCastBy } : {}),
    });

    return ok({
      deckId,
      samples,
      odds: {
        trials: sim.trials,
        keepablePct: sim.keepableRatePct,
        turn3LandPct: sim.turn3LandDropPct,
        earlyRampPct: sim.earlyRampInHandPct,
        ...(mustCastBy
          ? {
              mustCastBy: {
                card: mustCastBy.cardName,
                turn: mustCastBy.turn,
                effectiveManaValue: mustCastBy.manaValue,
                castablePct: sim.mustCastByPct ?? 0,
              },
            }
          : {}),
      },
    });
  }

  return { drawSample };
}

/** "Castable by turn N" for the named card (or the commander), with cost reducers counted. */
function mustCastOption(
  view: DeckView,
  profile: DeckPlan | null,
  request: DrawSampleRequest,
): MustCastByOption | undefined {
  if (request.mustCastTurn === undefined) return undefined;
  const commander = view.lines.find((line) => line.board === "commander");
  const targetName = request.mustCastCard ?? commander?.name;
  if (!targetName) return undefined;
  const line =
    view.lines.find((candidate) => candidate.name.toLowerCase() === targetName.toLowerCase()) ??
    commander;
  if (!line) return undefined;
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
    cardName: line.name,
    manaValue,
    turn: request.mustCastTurn,
    inLibrary: line.board !== "commander",
    pips: parseCost(line.manaCost).pips,
  };
}
