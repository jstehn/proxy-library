import { z } from "zod";
import { checkOwnedCards, deckView, getDeckProfile, isPlayed, isAvoidCard } from "@/modules/decks";
import { deckNotFound, defineTool, done, failed } from "../tool";

const EDHREC_FRAMING =
  "Popularity data: shows what people play, not what is good. Inclusion % is not win rate.";

// EDHREC lookups for the edhrec_lookup tool (P09 moves them to a binding).

const deckId = z.number().int().positive().describe("The deck's id, from list_decks.");

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
