import { z } from "zod";
import type {
  CommanderMissing,
  EdhrecDeckComparison,
  EdhrecNotFound,
  EdhrecUnavailable,
} from "@/modules/decks";
import type { EdhrecCommanderData } from "@/modules/catalog";
import { err, ok } from "@/shared/kernel";
import { defineBinding } from "../binding";
import { edhrecHeader } from "../present/edhrec";
import type { ToolError } from "../tool";

type Answer =
  | Readonly<{ kind: "commander"; data: EdhrecCommanderData }>
  | Readonly<{ kind: "deck"; comparison: EdhrecDeckComparison }>;

type Failure =
  | Readonly<{ kind: "InvalidInput"; message: string }>
  | Readonly<{ kind: "DeckNotFound" }>
  | CommanderMissing
  | EdhrecUnavailable
  | EdhrecNotFound;

export const edhrecLookupBinding = defineBinding({
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
  async call(capabilities, actor, input) {
    if (input.deckId !== undefined) {
      const comparison = await capabilities.edhrec.compareDeck({
        userId: actor.userId,
        deckId: input.deckId,
        theme: input.theme,
      });
      return comparison.ok
        ? ok<Answer>({ kind: "deck", comparison: comparison.value })
        : comparison;
    }
    if (!input.commander) {
      return err<Failure>({
        kind: "InvalidInput",
        message: "Provide `commander` or `deckId`.",
      });
    }
    const page = await capabilities.edhrec.forCommander({
      commander: input.commander,
      theme: input.theme,
    });
    return page.ok ? ok<Answer>({ kind: "commander", data: page.value }) : page;
  },
  present(answer, { input }) {
    if (answer.kind === "commander") {
      const { data } = answer;
      return {
        ...edhrecHeader(data, input.theme),
        themes: data.themes.slice(0, 20),
        totalCards: data.cards.length,
        cards: data.cards.slice(0, input.limit),
        averageDecklist: data.averageDecklist,
      };
    }
    const { comparison } = answer;
    return {
      ...edhrecHeader(comparison.data, input.theme),
      inDeckWithEdhrec: comparison.inDeckWithEdhrec,
      highInclusionNotInDeck: comparison.highInclusionNotInDeck,
      inDeckNotOnEdhrec: comparison.inDeckNotOnEdhrec,
      ...(comparison.leftOutAvoid.length > 0 ? { leftOutAvoid: comparison.leftOutAvoid } : {}),
    };
  },
  describeError(failure, { input }): ToolError {
    switch (failure.kind) {
      case "InvalidInput":
        return failure;
      case "DeckNotFound":
        return {
          kind: "DeckNotFound",
          message: `Deck ${input.deckId} isn't one of your decks. Call list_decks to see their ids.`,
        };
      case "CommanderMissing":
        return {
          kind: "CommanderMissing",
          message: "Put a commander on the commander board first before calling compare_to_edhrec.",
        };
      case "EdhrecUnavailable":
        return {
          kind: "EdhrecUnavailable",
          message: `Could not reach EDHREC: ${failure.reason}.`,
        };
      case "EdhrecNotFound":
        return {
          kind: "EdhrecNotFound",
          message: `No EDHREC page found for "${failure.commander}".`,
        };
    }
  },
});
