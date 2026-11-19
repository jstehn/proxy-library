import { z } from "zod";
import {
  colorPips,
  commanderOnlyProfile,
  deckView,
  effectiveManaValue,
  findCard,
  getDeckProfile,
  library,
  simulateOpeningHands,
  type MustCastByOption,
} from "@/modules/decks";
import { seededRng } from "@/shared/kernel";
import { deckNotFound, defineTool, done, failed } from "../tool";
import { compareToEdhrecTool, edhrecCommanderTool } from "./decks";
import { checkInteractionTool, getRulingsTool, lookupRulesTool } from "./library";
import { compactMoneyFields } from "../present/money";

const deckIdField = z.number().int().positive().describe("Deck id from list_decks.");

/** 7. edhrec_lookup (merges edhrec_commander + compare_to_edhrec) */
export const edhrecLookupTool = defineTool({
  name: "edhrec_lookup",
  title: "EDHREC commander & deck comparison",
  description:
    "Fetch EDHREC popularity data for a `commander` (top cards, themes) or compare a `deckId` against EDHREC (missing high-synergy cards & low-inclusion cards).",
  scope: "read",
  readOnly: true,
  input: z.object({
    commander: z.string().min(1).optional().describe("Commander name (when not passing deckId)."),
    deckId: z.number().int().positive().optional().describe("Deck id to compare against EDHREC."),
    bracket: z
      .number()
      .int()
      .min(1)
      .max(5)
      .optional()
      .describe("Optional EDHREC bracket filter (1-5)."),
    theme: z.string().min(1).max(80).optional().describe("Optional EDHREC theme slug."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(40)
      .default(15)
      .describe("Max cards to return (default 15)."),
  }),
  async run(context, input) {
    if (input.deckId !== undefined) {
      const res = await compareToEdhrecTool.run(context, {
        deckId: input.deckId,
        bracket: input.bracket,
        theme: input.theme,
        limit: input.limit,
      });
      return res.ok ? done(compactMoneyFields(res.value)) : res;
    }
    if (!input.commander) {
      return failed("InvalidInput", "Provide `commander` or `deckId`.");
    }
    const res = await edhrecCommanderTool.run(context, {
      commander: input.commander,
      bracket: input.bracket,
      theme: input.theme,
      limit: input.limit,
    });
    return res.ok ? done(compactMoneyFields(res.value)) : res;
  },
});

/** 9. draw_sample (replaces goldfish_start, goldfish_step, simulate_opening_hands) */
export const drawSampleTool = defineTool({
  name: "draw_sample",
  title: "Sample opening hands, next draws & deterministic castability",
  description:
    "Deals `hands` shuffled 7-card opening hands plus the next `drawNext` cards from the deck so you can evaluate playability, and runs deterministic simulation for keepable-hand rate, turn-3 land drop rate, and optional `mustCastBy` turn-N castability.",
  scope: "read",
  readOnly: true,
  input: z.object({
    deckId: deckIdField,
    hands: z
      .number()
      .int()
      .min(1)
      .max(5)
      .default(1)
      .describe("Opening hands to deal (1-5, default 1)."),
    drawNext: z
      .number()
      .int()
      .min(0)
      .max(15)
      .default(5)
      .describe("Next X cards drawn after the opening 7 (0-15, default 5)."),
    trials: z
      .number()
      .int()
      .min(100)
      .max(2000)
      .default(500)
      .describe("Deterministic sim trials for odds (default 500)."),
    mustCastCard: z
      .string()
      .min(1)
      .optional()
      .describe("Card name for castable-by-turn-N sim (defaults to commander)."),
    mustCastTurn: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe("Turn by which mustCastCard should be castable."),
    seed: z.string().max(64).optional().describe("Optional deterministic RNG seed."),
  }),
  async run(context, input) {
    const [view, storedProfile] = await Promise.all([
      deckView(context.container.db, context.actor.userId, input.deckId),
      getDeckProfile(context.container.db, context.actor.userId, input.deckId),
    ]);
    if (view === null) return deckNotFound(input.deckId);

    const cards = library(view.lines);
    if (cards.length < 7) {
      return failed("DeckTooSmall", "Deck needs at least 7 main-board cards to draw a sample.");
    }

    const lineByOracle = new Map(view.lines.map((l) => [l.oracleId, l]));
    const rng = seededRng(
      input.seed ?? `${input.deckId}:${context.container.clock.now().getTime()}`,
    );
    const samples: {
      hand: { name: string; manaCost: string; typeLine: string }[];
      nextDraws: { name: string; manaCost: string; typeLine: string }[];
    }[] = [];

    for (let h = 0; h < input.hands; h++) {
      const deckCopy = [...cards];
      for (let i = deckCopy.length - 1; i > 0; i--) {
        const j = Math.floor(rng.next() * (i + 1));
        [deckCopy[i], deckCopy[j]] = [deckCopy[j], deckCopy[i]];
      }
      const toCompact = (c: (typeof deckCopy)[number]) => {
        const line = lineByOracle.get(c.oracleId);
        return {
          name: c.name,
          manaCost: line?.manaCost ?? "",
          typeLine: line?.typeLine ?? "",
        };
      };
      samples.push({
        hand: deckCopy.slice(0, 7).map(toCompact),
        nextDraws: deckCopy.slice(7, 7 + input.drawNext).map(toCompact),
      });
    }

    let mustCastBy: MustCastByOption | undefined;
    if (input.mustCastTurn !== undefined) {
      const cmd = view.lines.find((l) => l.board === "commander");
      const targetName = input.mustCastCard ?? cmd?.name;
      if (targetName) {
        const line =
          view.lines.find((l) => l.name.toLowerCase() === targetName.toLowerCase()) ?? cmd;
        if (line) {
          const commanderNames = view.lines
            .filter((l) => l.board === "commander")
            .map((l) => l.name);
          const effMv = effectiveManaValue(
            line.manaValue ?? 0,
            {
              typeLine: line.typeLine,
              manaCost: line.manaCost,
              oracleText: line.text,
              isCommander: line.board === "commander",
            },
            commanderOnlyProfile(storedProfile?.profile, commanderNames),
            0,
          );
          mustCastBy = {
            cardName: line.name,
            manaValue: effMv,
            turn: input.mustCastTurn,
            inLibrary: line.board !== "commander",
            colorPips: colorPips(line.manaCost),
          };
        }
      }
    }

    const sim = simulateOpeningHands(cards, {
      rng: seededRng(input.seed ?? `sim-${view.deck.id}`),
      trials: input.trials,
      minLands: 2,
      maxLands: 4,
      requireEarlyPlay: true,
      freeMulligan: view.deck.format === "commander",
      onTheDraw: false,
      ...(mustCastBy ? { mustCastBy } : {}),
    });

    return done({
      deckId: input.deckId,
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
  },
});

/** 10. rules_lookup (merges get_rulings, check_interaction, lookup_rules) */
export const rulesLookupTool = defineTool({
  name: "rules_lookup",
  title: "Card rulings, interactions, and Comprehensive Rules",
  description:
    "Look up official Scryfall rulings for 1 card, check rules interactions between 2+ `cards`, or search the MTG Comprehensive Rules by rule number/keyword (`query`).",
  scope: "read",
  readOnly: true,
  input: z.object({
    cards: z
      .array(z.string().min(1))
      .min(1)
      .max(4)
      .optional()
      .describe("1 card for rulings, or 2-4 cards to check interactions."),
    query: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe("Comprehensive Rules number (e.g. '702.61a') or keyword."),
  }),
  async run(context, input) {
    if (input.query) {
      return lookupRulesTool.run(context, { query: input.query, limit: 8 });
    }
    if (input.cards && input.cards.length >= 2) {
      return checkInteractionTool.run(context, { cards: input.cards });
    }
    if (input.cards && input.cards.length === 1) {
      const card = await findCard(context.container.db, input.cards[0]);
      if (card === null) {
        return failed("CardNotFound", `No card named "${input.cards[0]}" in catalog.`);
      }
      return getRulingsTool.run(context, { card: card.name });
    }
    return failed("InvalidInput", "Provide `cards` (1-4 names) or `query` (CR rule/keyword).");
  },
});
