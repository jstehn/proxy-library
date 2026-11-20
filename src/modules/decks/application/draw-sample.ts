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
import { colorPips } from "../domain/stats";
import { commanderOnlyProfile, effectiveManaValue, type DeckPlan } from "../domain/deck-profile";
import type { DeckView } from "../domain/deck-view";
import { library } from "../domain/draws";
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

const HAND_SIZE = 7;

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
    if (cards.length < HAND_SIZE) return err({ kind: "DeckTooSmall", minimum: HAND_SIZE });

    const lineByOracle = new Map(view.lines.map((line) => [line.oracleId, line]));
    const rng = seededRng(request.seed ?? `${deckId}:${readers.clock.now().getTime()}`);
    const compact = (card: (typeof cards)[number]): SampleCard => {
      const line = lineByOracle.get(card.oracleId);
      return { name: card.name, manaCost: line?.manaCost ?? "", typeLine: line?.typeLine ?? "" };
    };

    const samples: { hand: SampleCard[]; nextDraws: SampleCard[] }[] = [];
    for (let handNumber = 0; handNumber < request.hands; handNumber++) {
      const shuffled = [...cards];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rng.next() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      samples.push({
        hand: shuffled.slice(0, HAND_SIZE).map(compact),
        nextDraws: shuffled.slice(HAND_SIZE, HAND_SIZE + request.drawNext).map(compact),
      });
    }

    const mustCastBy = mustCastOption(view, profile, request);
    const sim = simulateOpeningHands(cards, {
      rng: seededRng(request.seed ?? `sim-${view.deck.id}`),
      trials: request.trials,
      minLands: 2,
      maxLands: 4,
      requireEarlyPlay: true,
      freeMulligan: formatRules(view.deck.format).freeFirstMulligan,
      onTheDraw: false,
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
      oracleText: line.text,
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
    colorPips: colorPips(line.manaCost),
  };
}
