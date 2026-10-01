import "server-only";
import { z } from "zod";
import { printingCards } from "@/modules/catalog";
import {
  DEFAULT_PROXY_OPTIONS,
  deckView,
  GAPS_IN_MILLIMETERS,
  type DeckView,
  type ProxyLine,
  type ProxyOptions,
} from "@/modules/decks";
import type { UserId } from "@/shared/kernel";
import { getContainer } from "@/server/container";

// Shared by the proxy options page and the PDF download: the deck as proxy lines, and the
// options read from the address (anything missing or unknown falls back to the default).

const defaults = DEFAULT_PROXY_OPTIONS;
const OptionsSchema = z.object({
  paper: z.enum(["letter", "a4"]).catch(defaults.paper),
  basicLands: z.enum(["skip", "include"]).catch(defaults.basicLands),
  backFaces: z.enum(["pages", "skip"]).catch(defaults.backFaces),
  cards: z.enum(["all", "noSideboard"]).catch(defaults.cards),
  gapMillimeters: z.coerce
    .number()
    .pipe(z.union(GAPS_IN_MILLIMETERS.map((gap) => z.literal(gap))))
    .catch(defaults.gapMillimeters),
  bleed: z.enum(["none", "eighthInch"]).catch(defaults.bleed),
  guides: z.enum(["corners", "lines", "none"]).catch(defaults.guides),
  copies: z.enum(["deck", "one"]).catch(defaults.copies),
});

/** The options in a query string such as `?paper=a4&bleed=eighthInch`. */
export function proxyOptionsFrom(parameters: URLSearchParams): ProxyOptions {
  return OptionsSchema.parse(Object.fromEntries(parameters));
}

/** The player's deck and its lines as the proxy sheet needs them, or null if it isn't theirs. */
export async function proxyDeck(
  userId: UserId,
  deckId: number,
): Promise<{ view: DeckView; lines: ProxyLine[] } | null> {
  const { db } = getContainer();
  const view = Number.isSafeInteger(deckId) ? await deckView(db, userId, deckId) : null;
  if (view === null) return null;
  const cards = await printingCards(
    db,
    view.lines.map((line) => line.printingId),
  );
  const lines = view.lines.map((line) => ({
    printingId: line.printingId,
    name: line.name,
    quantity: line.quantity,
    board: line.board,
    isBasicLand: line.isBasicLand,
    hasBack: cards.get(line.printingId)?.hasBackImage ?? false,
  }));
  return { view, lines };
}
