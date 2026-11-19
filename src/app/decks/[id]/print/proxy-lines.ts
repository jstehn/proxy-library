import "server-only";
import { z } from "zod";
import {
  cardsToPrint,
  DEFAULT_PROXY_OPTIONS,
  GAPS_IN_MILLIMETERS,
  TOKEN_COPIES,
  type ProxyDeck,
  type ProxyOptions,
  type ProxySheetInput,
} from "@/modules/decks";

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
