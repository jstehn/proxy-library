import type { Finish, PrintingId } from "@/modules/catalog";
import type { ImportLine } from "./readers";

// Matching import lines to printings (design doc 16, sections 4 and 4.1). The matcher adapter
// reads every printing the import could mean in one query; choosing among them is pure.

/** A printing an import line might mean, with what's needed to choose among them. */
export type PrintingCandidate = Readonly<{
  printingId: PrintingId;
  oracleId: string;
  setCode: string;
  collectorNumber: string;
  /** The set's type ("expansion", "promo", …) and release date ("2024-08-02"). */
  setType: string;
  releaseDate: string;
  finishes: readonly Finish[];
  borderColor: string;
  frameEffects: readonly string[];
  promoTypes: readonly string[];
  isFullArt: boolean;
}>;

export type UnmatchedReason =
  | Readonly<{ kind: "NoSuchCard" }> // no printing has that name
  | Readonly<{ kind: "NoSuchPrinting" }> // the card exists, but not with that set and number
  | Readonly<{ kind: "FinishNotAvailable"; finishes: Finish[] }>; // e.g. a foil copy of a nonfoil-only card

/** What one line becomes once matched (the preview shows one per line). */
export type MatchedLine =
  | Readonly<{ kind: "Matched"; line: ImportLine; printingId: PrintingId; oracleId: string }>
  | Readonly<{ kind: "Unmatched"; line: ImportLine; reason: UnmatchedReason }>;

/** What the matcher found in the catalog for a whole import. */
export type CatalogMatches = Readonly<{
  /** Every printing of each named card, by `normalizedName` (front-face names too). */
  byName: ReadonlyMap<string, readonly PrintingCandidate[]>;
  byScryfallId: ReadonlyMap<string, PrintingCandidate>;
}>;

/** How names are compared: case, extra spaces and curly apostrophes don't matter. */
export function normalizedName(name: string): string {
  return name.toLowerCase().replaceAll("’", "'").replace(/\s+/g, " ").trim();
}

// Set types whose printings are never a card's "ordinary" printing: promos, tokens, Secret
// Lairs (box), gold-bordered and other memorabilia, Un-sets, minigames, Masterpieces.
const SPECIAL_SET_TYPES = new Set([
  "promo",
  "token",
  "memorabilia",
  "box",
  "funny",
  "minigame",
  "masterpiece",
  "vanguard",
  "alchemy",
]);
// Promo types that mark a special version: stamps, promo programs, special foils, serialized.
// Others (universesbeyond, startercollection, …) are on ordinary printings too.
const SPECIAL_PROMO_TYPES = new Set([
  "boosterfun",
  "boxtopper",
  "buyabox",
  "bundle",
  "datestamped",
  "doublerainbow",
  "embossed",
  "firstplacefoil",
  "fracturefoil",
  "galaxyfoil",
  "halofoil",
  "instore",
  "japanshowcase",
  "jpwalker",
  "mediainsert",
  "neonink",
  "oilslick",
  "planeswalkerstamped",
  "poster",
  "prerelease",
  "promopack",
  "raisedfoil",
  "rainbowfoil",
  "ripplefoil",
  "scroll",
  "serialized",
  "setpromo",
  "silverfoil",
  "silverscroll",
  "stamped",
  "stepandcompleat",
  "surgefoil",
  "textured",
  "thick",
]);
const SPECIAL_FRAME_EFFECTS = new Set(["showcase", "extendedart", "fullart", "inverted"]);

/**
 * Section 4.1: an ordinary printing is a regular release of the card, not a promo, token, or
 * special treatment (borderless, showcase, extended art, full art, serialized).
 */
export function isOrdinaryPrinting(candidate: PrintingCandidate): boolean {
  return (
    !SPECIAL_SET_TYPES.has(candidate.setType) &&
    candidate.borderColor !== "borderless" &&
    !candidate.isFullArt &&
    !candidate.frameEffects.some((effect) => SPECIAL_FRAME_EFFECTS.has(effect)) &&
    !candidate.promoTypes.some((type) => SPECIAL_PROMO_TYPES.has(type))
  );
}

/** Newest release first; within a set, the lowest collector number. */
function newestFirst(a: PrintingCandidate, b: PrintingCandidate): number {
  return (
    b.releaseDate.localeCompare(a.releaseDate) ||
    a.setCode.localeCompare(b.setCode) ||
    a.collectorNumber.localeCompare(b.collectorNumber, "en", { numeric: true })
  );
}

/**
 * Section 4.1: the card's newest ordinary printing that comes in this finish, or failing that
 * the newest printing in this finish. Null if no printing comes in it.
 */
export function newestOrdinaryPrinting(
  candidates: readonly PrintingCandidate[],
  finish: Finish,
): PrintingCandidate | null {
  const inFinish = candidates.filter((candidate) => candidate.finishes.includes(finish));
  const sorted = [...inFinish].sort(newestFirst);
  return sorted.find(isOrdinaryPrinting) ?? sorted[0] ?? null;
}

/** Every finish any of these printings comes in, for the "not in that finish" message. */
function finishesOf(candidates: readonly PrintingCandidate[]): Finish[] {
  return [...new Set(candidates.flatMap((candidate) => candidate.finishes))];
}

/** The printings that a set code (and collector number, if given) narrow the line down to. */
function narrowed(line: ImportLine, candidates: readonly PrintingCandidate[]) {
  if (line.setCode === null) return candidates;
  return candidates.filter(
    (candidate) =>
      candidate.setCode === line.setCode &&
      (line.collectorNumber === null ||
        candidate.collectorNumber.toLowerCase() === line.collectorNumber.toLowerCase()),
  );
}

/**
 * Matches one line: by Scryfall id when it has one the catalog knows, else by name, narrowed by
 * set and collector number when given, choosing the newest ordinary printing when not.
 */
export function matchLine(line: ImportLine, matches: CatalogMatches): MatchedLine {
  const exact = line.scryfallId === null ? undefined : matches.byScryfallId.get(line.scryfallId);
  const named = matches.byName.get(normalizedName(line.name)) ?? [];
  if (exact === undefined && named.length === 0) {
    return { kind: "Unmatched", line, reason: { kind: "NoSuchCard" } };
  }
  const possible = exact === undefined ? narrowed(line, named) : [exact];
  if (possible.length === 0) {
    return { kind: "Unmatched", line, reason: { kind: "NoSuchPrinting" } };
  }
  const chosen = newestOrdinaryPrinting(possible, line.finish);
  if (chosen === null) {
    const reason: UnmatchedReason = { kind: "FinishNotAvailable", finishes: finishesOf(possible) };
    return { kind: "Unmatched", line, reason };
  }
  return { kind: "Matched", line, printingId: chosen.printingId, oracleId: chosen.oracleId };
}
