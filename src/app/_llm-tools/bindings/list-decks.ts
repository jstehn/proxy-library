import { z } from "zod";
import { defineBinding } from "../binding";

export const listDecksBinding = defineBinding({
  name: "list_decks",
  title: "List my decks",
  description: [
    "Lists your decks, most recently changed first: id, name, format, card count, and how many cards each is short (copies the deck uses that you don't own).",
    "Use it when: you need a deck's id, or an overview of the decks. Then call get_deck for one deck.",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({}),
  call: (capabilities, actor) => capabilities.listDecks(actor),
  // Defaults are left out per deck (most decks are private and use real cards) and said once.
  present: (decks) => ({
    note: "usesRealCards is true and visibility is private unless a deck says otherwise.",
    decks: decks.map((deck) => ({
      id: deck.id,
      name: deck.name,
      format: deck.format,
      cards: deck.cards,
      short: deck.short,
      ...(deck.usesRealCards ? {} : { usesRealCards: false }),
      ...(deck.visibility === "private" ? {} : { visibility: deck.visibility }),
      updated: deck.updatedAt.slice(0, 10),
    })),
  }),
});
