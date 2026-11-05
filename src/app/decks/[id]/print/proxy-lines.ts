import "server-only";
import { z } from "zod";
import { printingCards } from "@/modules/catalog";
import {
  cardsToPrint,
  DEFAULT_PROXY_OPTIONS,
  deckTokenLines,
  deckView,
  GAPS_IN_MILLIMETERS,
  TOKEN_COPIES,
  type DeckView,
  type ProxyLine,
  type ProxyOptions,
  type ProxySheetInput,
  type TokenLine,
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
  bleed: z.enum(["none", "fillGap"]).catch(defaults.bleed),
  guides: z.enum(["corners", "lines", "none"]).catch(defaults.guides),
  copies: z.enum(["deck", "one"]).catch(defaults.copies),
  foils: z.enum(["mixed", "ownPages"]).catch(defaults.foils),
  style: z.enum(["scan", "playtest"]).catch(defaults.style),
  artFilter: z.enum(["color", "grayscale", "edges", "none"]).catch(defaults.artFilter),
  stripes: z.enum(["on", "off"]).catch(defaults.stripes),
  realCards: z.enum(["print", "leaveOut"]).catch(defaults.realCards),
  tokenCopies: z.coerce
    .number()
    .pipe(z.union(TOKEN_COPIES.map((copies) => z.literal(copies))))
    .catch(defaults.tokenCopies),
});

/** The options in a query string such as `?paper=a4&bleed=fillGap`. */
export function proxyOptionsFrom(parameters: URLSearchParams): ProxyOptions {
  return OptionsSchema.parse(Object.fromEntries(parameters));
}

/** A deck's proxy sheet: the deck, its lines and the tokens its cards make (design doc 25). */
export type ProxyDeck = Readonly<{ view: DeckView; lines: ProxyLine[]; tokens: TokenLine[] }>;

/** The player's deck as the proxy sheet needs it, or null if it isn't theirs. */
export async function proxyDeck(userId: UserId, deckId: number): Promise<ProxyDeck | null> {
  const { db } = getContainer();
  const view = Number.isSafeInteger(deckId) ? await deckView(db, userId, deckId) : null;
  if (view === null) return null;
  const cards = await printingCards(
    db,
    view.lines.map((line) => line.printingId),
  );
  const lines = view.lines.map((line): ProxyLine => {
    const card = cards.get(line.printingId);
    return {
      oracleId: line.oracleId,
      printingId: line.printingId,
      name: line.name,
      quantity: line.quantity,
      // Counted only when the deck uses real cards (design doc 16).
      ownedReal: line.ownedReal,
      board: line.board,
      isBasicLand: line.isBasicLand,
      hasBack: card?.hasBackImage ?? false,
      isFoil: line.finish !== "nonfoil", // foil and etched both print on foil paper
      // What a playtest proxy prints (design doc 22). A printing missing from the catalog
      // still gets a card with its name, rather than stopping the sheet.
      printed: {
        faces: card?.faces ?? [
          {
            name: line.name,
            manaCost: null,
            typeLine: "",
            text: "",
            power: null,
            toughness: null,
            loyalty: null,
            defense: null,
          },
        ],
        doubleFaced: card?.hasBackImage ?? false,
        colors: card?.colors ?? [],
        producedMana: card?.producedMana ?? [],
        setCode: card?.setCode ?? "",
        collectorNumber: card?.collectorNumber ?? "",
        artist: card?.artist ?? null,
        isToken: false,
      },
    };
  });
  const tokens = await deckTokenLines(
    db,
    view.deck.id,
    view.lines.map((line) => ({
      oracleId: line.oracleId,
      printingId: line.printingId,
      name: line.name,
      board: line.board,
    })),
  );
  return { view, lines, tokens };
}

/**
 * The "Preview one card" PDF: the first card these options print, once. A deck whose cards are
 * all left out (all real, say) previews its first token instead.
 */
export function previewSheet(deck: ProxyDeck, options: ProxyOptions): ProxySheetInput {
  const [first] = cardsToPrint(deck.lines, options);
  const line = deck.lines.find((candidate) => candidate.printingId === first?.printingId);
  if (line !== undefined) return { lines: [{ ...line, quantity: 1 }], tokens: [] };
  const token = deck.tokens.find((candidate) => candidate.included);
  return { lines: [], tokens: token === undefined ? [] : [token] };
}
