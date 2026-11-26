import { z } from "zod";
import { FORMATS, MAX_HEADING_LENGTH, MAX_HEADINGS, type StartedDeck } from "@/modules/decks";
import { defineBinding } from "../binding";

/** What a heading refusal says (design doc 34). */
const HEADING_RULE = `A heading starts with a letter, has at most ${MAX_HEADING_LENGTH} characters, and isn't a board or card type name ("Sideboard", "Creatures"). A deck has at most ${MAX_HEADINGS}.`;

export const createDeckBinding = defineBinding({
  name: "create_deck",
  title: "Create a deck",
  description: [
    "Makes a new, empty deck and returns its id. Optionally fills it from a list in the usual text format.",
    'Use it when: the player wants a new deck. Pass a list here with board headers ("Commander", "Deck", "Sideboard", "Maybeboard" — always include "Deck" after "Commander") or custom main-deck headings ("Ramp (9)" or "Ramp:"), then lines like "1 Sol Ring".',
    `Rules: cards you don't own may be added; they show as short. ${HEADING_RULE} (So "Lands (37)" or "Creatures (25)" are ignored as custom headings; use e.g. "Mana base:" if you want a custom heading.)`,
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
        'Optional cards to start with, one per line: "1 Sol Ring". Board headers: Commander, Deck, Sideboard, Maybeboard (put Deck after Commander). Custom headings: "Ramp (9)" or "Ramp:".',
      ),
  }),
  call: (capabilities, actor, input) =>
    capabilities.startDeck.startDeck(actor, {
      name: input.name,
      format: input.format,
      targetBracket: input.targetBracket as 1 | 2 | 3 | 4 | 5 | undefined,
      list: input.list,
    }),
  present(started: StartedDeck, { input }) {
    if (input.list.trim() === "" || started.listError !== null) {
      return {
        deckId: started.deckId,
        added: 0,
        ...(started.listError !== null && input.list.trim() !== ""
          ? { listError: started.listError }
          : {}),
      };
    }
    return {
      deckId: started.deckId,
      added: started.added,
      ...(started.boards !== undefined && Object.keys(started.boards).length > 0
        ? { boards: started.boards }
        : {}),
      ...(started.warnings !== undefined && started.warnings.length > 0
        ? { warnings: started.warnings }
        : {}),
      unreadable: started.unreadable,
      notFound: started.notFound,
    };
  },
  describeError(failure) {
    return failure.kind === "NameInvalid"
      ? {
          kind: "NameInvalid",
          message: `Give the deck a name of up to ${failure.maximum} characters.`,
        }
      : {
          kind: "TooManyDecks",
          message: `You already have ${failure.maximum} decks; that's the most.`,
        };
  },
});
