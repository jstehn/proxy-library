import { z } from "zod";
import { defineBinding } from "../binding";

export const getAccountBinding = defineBinding({
  name: "get_account",
  title: "My account",
  description: [
    "Who you are and what you have: your play-money balance (cents), allowance if any, collection totals, and how many decks and wishes you have.",
    "Use it when: starting a conversation, or before suggesting purchases (to stay within the balance). For the wishlist itself, call manage_wishlist (action 'list').",
  ].join("\n"),
  scope: "read",
  readOnly: true,
  input: z.object({}),
  call: (capabilities, actor) => capabilities.getAccountOverview(actor),
  present: (overview, { actor, scopes }) => ({
    player: { username: actor.username, displayName: actor.displayName },
    scopes,
    balance: overview.balanceCents,
    allowance:
      overview.allowance === null
        ? null
        : {
            amount: overview.allowance.amountCents,
            everyDays: overview.allowance.everyDays,
            next: overview.allowance.next.toISOString(),
          },
    collection: {
      differentCards: overview.collection.differentCards,
      copies: overview.collection.copies,
      value: overview.collection.valueCents,
    },
    decks: overview.decks,
    wishes: overview.wishes,
  }),
});
