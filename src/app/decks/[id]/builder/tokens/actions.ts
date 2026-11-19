"use server";
import type { TokenLine } from "@/modules/decks";
import { action } from "@/server/action-instance";
import { DeckIdInput } from "../action-helpers";

/** Tokens, emblems, and helper cards created by a deck's counted cards (design doc 42). */
export const tokensAction = action(
  DeckIdInput,
  async ({ actor, capabilities }, deckId): Promise<TokenLine[] | null> => {
    const overview = await capabilities.deckOverview({
      userId: actor.userId,
      deckId,
      parts: { tokens: true },
    });
    return overview.ok ? [...(overview.value.tokens ?? [])] : null;
  },
);
