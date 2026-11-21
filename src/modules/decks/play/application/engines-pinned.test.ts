import { describe, expect, it } from "vitest";
import { seededRng, type UserId } from "@/shared/kernel";
import type { TapMana } from "@/modules/catalog";
import { makeDrawSample } from "./draw-sample";
import { aLine } from "../../core/testing/deck-view";
import type { Deck, DeckLine, DeckView, Pip } from "@/modules/decks/core/client";
import { simulateCastOnCurve, type CastabilityLine } from "../domain/castability";
import { openingHandOdds } from "../domain/draws";
import { COMMANDER_KEEP, dealHand as startHand, nextHand } from "../domain/opening-hand/hand";
import { library } from "../domain/opening-hand/library";
import { simulateOpeningHands } from "../domain/goldfish";
import { simulateCasting } from "../domain/cast-by-turn";

// Characterization of the opening-hand and payment engines (P15): seeded runs on one reference
// deck, recorded before the engines were merged. A difference here is a change in behaviour.

type Entry = Readonly<{
  name: string;
  quantity: number;
  typeLine: string;
  manaValue: number;
  manaCost: string | null;
  producedMana?: readonly string[];
  roles?: DeckLine["roles"];
  board?: "main" | "commander";
}>;

const DECK: readonly Entry[] = [
  {
    name: "Henzie",
    quantity: 1,
    typeLine: "Legendary Creature — Elf",
    manaValue: 5,
    manaCost: "{3}{B}{G}",
    board: "commander",
  },
  {
    name: "Forest",
    quantity: 14,
    typeLine: "Basic Land — Forest",
    manaValue: 0,
    manaCost: null,
    producedMana: ["G"],
  },
  {
    name: "Swamp",
    quantity: 10,
    typeLine: "Basic Land — Swamp",
    manaValue: 0,
    manaCost: null,
    producedMana: ["B"],
  },
  {
    name: "Woodland Cemetery",
    quantity: 6,
    typeLine: "Land",
    manaValue: 0,
    manaCost: null,
    producedMana: ["B", "G"],
  },
  {
    name: "Command Tower",
    quantity: 2,
    typeLine: "Land",
    manaValue: 0,
    manaCost: null,
    producedMana: ["W", "U", "B", "R", "G"],
  },
  {
    name: "Llanowar Elves",
    quantity: 1,
    typeLine: "Creature — Elf Druid",
    manaValue: 1,
    manaCost: "{G}",
    producedMana: ["G"],
    roles: ["ramp"],
  },
  {
    name: "Sol Ring",
    quantity: 1,
    typeLine: "Artifact",
    manaValue: 1,
    manaCost: "{1}",
    producedMana: ["C"],
    roles: ["ramp"],
  },
  {
    name: "Cultivate",
    quantity: 1,
    typeLine: "Sorcery",
    manaValue: 3,
    manaCost: "{2}{G}",
    roles: ["ramp"],
  },
  {
    name: "Worldspine Wurm",
    quantity: 1,
    typeLine: "Artifact",
    manaValue: 5,
    manaCost: "{4}{G}",
    producedMana: ["G"],
    roles: ["ramp"],
  },
  {
    name: "Night's Whisper",
    quantity: 1,
    typeLine: "Sorcery",
    manaValue: 2,
    manaCost: "{1}{B}",
    roles: ["draw"],
  },
  {
    name: "Hybrid Elf",
    quantity: 2,
    typeLine: "Creature — Elf",
    manaValue: 2,
    manaCost: "{B/G}{B/G}",
  },
  {
    name: "Phyrexian Gargoyle",
    quantity: 2,
    typeLine: "Creature — Gargoyle",
    manaValue: 3,
    manaCost: "{2}{B/P}",
  },
  { name: "Twobrid Tutor", quantity: 1, typeLine: "Instant", manaValue: 2, manaCost: "{2/B}{2/B}" },
  {
    name: "Blightsteel Colossus",
    quantity: 1,
    typeLine: "Artifact Creature — Golem",
    manaValue: 12,
    manaCost: "{12}",
  },
  {
    name: "Walking Ballista",
    quantity: 1,
    typeLine: "Artifact Creature",
    manaValue: 0,
    manaCost: "{X}{X}",
  },
  {
    name: "Obliterator",
    quantity: 2,
    typeLine: "Creature — Phyrexian",
    manaValue: 4,
    manaCost: "{B}{B}{B}{B}",
  },
  { name: "Bear", quantity: 12, typeLine: "Creature — Bear", manaValue: 2, manaCost: "{1}{G}" },
  { name: "Giant", quantity: 8, typeLine: "Creature — Giant", manaValue: 4, manaCost: "{2}{B}{G}" },
  { name: "Wurm", quantity: 6, typeLine: "Creature — Wurm", manaValue: 6, manaCost: "{4}{G}{G}" },
];

function lines(): DeckLine[] {
  return DECK.map((entry) =>
    aLine(entry.name, {
      quantity: entry.quantity,
      typeLine: entry.typeLine,
      manaValue: entry.manaValue,
      manaCost: entry.manaCost,
      producedMana: [...(entry.producedMana ?? [])],
      roles: entry.roles ?? [],
      board: entry.board ?? "main",
    }),
  );
}

const NO_TAP: TapMana = { isSource: false, amount: 0, requiresFiveLands: false };

/** What the catalog's card features say about a line: lands and mana rocks tap for mana. */
function tapOf(line: DeckLine): Pick<CastabilityLine, "tapMana" | "entersTapped" | "landFetch"> {
  const isLand = line.typeLine.includes("Land");
  const isRock = !isLand && line.roles.includes("ramp") && line.producedMana.length > 0;
  return {
    tapMana: isLand || isRock ? { isSource: true, amount: 1, requiresFiveLands: false } : NO_TAP,
    entersTapped: line.name === "Woodland Cemetery" ? "sometimes" : "never",
    // Cultivate: any basic land, onto the battlefield tapped (P28b).
    landFetch:
      line.name === "Cultivate" ? { entersTapped: true, colors: ["W", "U", "B", "R", "G"] } : null,
  };
}

function featuredLines() {
  return lines().map((line) => ({ ...line, ...tapOf(line) }));
}

function castLines(): CastabilityLine[] {
  return featuredLines();
}

const BASE = { trials: 600 };

describe("engines, pinned", () => {
  const cards = library(lines());

  it("opening hands: the scorecard's run", () => {
    expect(
      simulateOpeningHands(cards, { rng: seededRng("audit-1"), trials: 500, freeMulligan: true }),
    ).toMatchSnapshot();
  });

  it("opening hands: a short deck", () => {
    expect(
      simulateOpeningHands(cards.slice(0, 70), { rng: seededRng("b"), ...BASE }),
    ).toMatchSnapshot();
  });

  it("castable by a turn (library card, commander, colourless): the cast simulator", () => {
    const castCards = library(featuredLines());
    const rule = { policy: COMMANDER_KEEP, freeMulligan: true, maxMulligans: 2 };
    const target = (name: string, manaValue: number, pips: Pip[], mustDraw: boolean) => ({
      name,
      typeLine: "Creature",
      manaValue,
      pips,
      mustDraw,
    });
    const run = (cast: ReturnType<typeof target>, lastTurn: number) =>
      simulateCasting(castCards, [cast], {
        rng: seededRng("m"),
        runs: 600,
        onTheDraw: false,
        lastTurn,
        rule,
      }).curves[0];
    const curves = [
      run(target("Giant", 4, [["B"], ["G"]], true), 4),
      run(target("Henzie", 5, [["B"], ["G"]], false), 5),
      run(target("Henzie", 3, [], false), 3),
      run(target("Wurm", 6, [["G"], ["G"]], true), 6),
    ];
    expect(curves.map((curve) => curve.byTurn.at(-1))).toMatchSnapshot();
  });

  it("odds table", () => {
    expect(openingHandOdds(cards, { onTheDraw: false, freeMulligan: true })).toMatchSnapshot();
  });

  it("cast on curve", () => {
    expect(
      simulateCastOnCurve(castLines(), { rng: seededRng("c"), trials: 400 }),
    ).toMatchSnapshot();
  });

  it("test hand: deal, mulligans, bottoming, draws", () => {
    const rng = seededRng("hand");
    let hand = startHand(cards, rng, true);
    const seen = [hand.hand.map((card) => card.key)];
    hand = nextHand(hand, { kind: "mulligan", rng });
    hand = nextHand(hand, { kind: "mulligan", rng });
    seen.push(hand.hand.map((card) => card.key));
    hand = nextHand(hand, { kind: "bottom", key: hand.hand[3].key });
    seen.push(hand.hand.map((card) => card.key));
    for (let i = 0; i < 3; i++) hand = nextHand(hand, { kind: "draw" });
    expect({
      seen,
      hand: hand.hand.map((card) => card.key),
      top: hand.library.slice(0, 4).map((card) => card.key),
      bottom: hand.library.slice(-2).map((card) => card.key),
      mulligans: hand.mulligans,
      turn: hand.turn,
    }).toMatchSnapshot();
  });

  it("draw_sample", async () => {
    const view = {
      deck: { id: 7, format: "commander" } as unknown as Deck,
      lines: featuredLines(),
      rules: {},
    } satisfies DeckView;
    const { drawSample } = makeDrawSample({
      deckView: async () => view,
      profile: async () => null,
      clock: { now: () => new Date("2026-01-01T00:00:00Z") },
    });
    const userId = "u" as unknown as UserId;
    const results = [
      await drawSample({ userId, deckId: 7, hands: 3, drawNext: 3, trials: 400, seed: "s" }),
      await drawSample({
        userId,
        deckId: 7,
        hands: 1,
        drawNext: 2,
        trials: 400,
        cast: ["commander"],
        lastTurn: 5,
        seed: "s",
      }),
      await drawSample({
        userId,
        deckId: 7,
        hands: 1,
        drawNext: 2,
        trials: 400,
        cast: ["Giant"],
        lastTurn: 4,
        seed: "s",
      }),
    ];
    expect(results).toMatchSnapshot();
  });

  it("draw_sample answers 'castable by turn Y' for the commander, one chance per turn", async () => {
    const view = {
      deck: { id: 7, format: "commander" } as unknown as Deck,
      lines: featuredLines(),
      rules: {},
    };
    const { castCurves } = makeDrawSample({
      deckView: async () => view,
      profile: async () => null,
      clock: { now: () => new Date("2026-01-01T00:00:00Z") },
    });
    const request = {
      userId: "u" as unknown as UserId,
      deckId: 7,
      cards: ["commander", "Giant"],
      onTheDraw: false,
      lastTurn: 6,
      runs: 300,
      seed: "s",
    };
    const result = await castCurves(request);
    expect(result).toEqual(await castCurves(request));
    if (!result.ok) throw new Error("expected a report");
    const [henzie, giant] = result.value.cards;
    expect(result.value).toMatchObject({ runs: 300, onTheDraw: false });
    expect(henzie.byTurnPct).toHaveLength(6);
    expect(henzie.byTurnPct[5]).toBeGreaterThan(henzie.byTurnPct[2]);
    expect(giant.card).toBe("Giant");
    const missing = await castCurves({ ...request, cards: ["Nonexistent"] });
    expect(missing).toMatchObject({ ok: false, error: { kind: "CastCardNotInDeck" } });
  });
});
