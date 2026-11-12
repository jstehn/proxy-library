import { isCounted, isPlayed, type Board } from "./boards";
import type { PrintedCard, PrintedFace } from "./playtest-card";
import { cardsToPrint, type ProxyCard, type ProxyLine, type ProxyOptions } from "./proxy-sheet";

// Token proxies (design doc 25): which tokens a deck's cards make, which art each one prints
// with, and the copies to print after the cards. Pure; the queries supply the rows.

/** One printing of a token: one art of a Goblin, a Treasure, an emblem. */
export type TokenArt = Readonly<{
  /** Scryfall's id, which the image cache also takes. */
  id: string;
  /** Shared by every art of the token. */
  oracleId: string;
  name: string;
  /** Scryfall's set code ("tblb") and the set's name, when the catalog lists the set. */
  setCode: string;
  setName: string;
  collectorNumber: string;
  colors: readonly string[];
  faces: readonly PrintedFace[];
  artist: string | null;
  releasedAt: string;
  /** Double-faced tokens (Incubator // Phyrexian) have a back image. */
  hasBack: boolean;
}>;

/** "This printing of a card makes that token printing" (Scryfall's `all_parts`). */
export type TokenLinkRow = Readonly<{
  /** The card that makes it, as any of its printings. */
  cardOracleId: string;
  printingId: string;
  token: TokenArt;
}>;

/** A deck card the sheet prints from, in deck order. */
export type TokenMaker = Readonly<{
  oracleId: string;
  /** The printing the deck shows (its token is the default art). */
  printingId: string;
  name: string;
  board: Board;
}>;

/** What you chose for a token in this deck. No choice: the default art, printed. */
export type TokenChoice = Readonly<{
  tokenOracleId: string;
  /** null: the default art. */
  tokenId: string | null;
  included: boolean;
}>;

/** One token the deck makes, as the print page lists it. */
export type TokenLine = Readonly<{
  oracleId: string;
  name: string;
  /** The deck's cards that make it, in deck order, each once. */
  madeBy: readonly string[];
  /** The boards of those cards, for "No sideboard". */
  boards: readonly Board[];
  /** The art that prints: your choice, or the default. */
  art: TokenArt;
  /** The default art's id (so the picker can mark it). */
  defaultArtId: string;
  /** Whether you chose this art (rather than getting the default). */
  artChosen: boolean;
  included: boolean;
}>;

/**
 * Every token the deck's cards make, by name (design doc 25, sections 3.1 and 3.2). The default
 * art is the token printing your card's own printing makes (the first such card in deck order);
 * failing that, any printing of the card's, newest first. `chosenArts` holds the printings you
 * picked, which needn't be ones a card links to.
 */
export function deckTokens(
  makers: readonly TokenMaker[],
  links: readonly TokenLinkRow[],
  choices: readonly TokenChoice[],
  chosenArts: ReadonlyMap<string, TokenArt>,
): TokenLine[] {
  const choiceFor = new Map(choices.map((choice) => [choice.tokenOracleId, choice]));
  const linksByCard = new Map<string, TokenLinkRow[]>();
  for (const link of links) {
    linksByCard.set(link.cardOracleId, [...(linksByCard.get(link.cardOracleId) ?? []), link]);
  }

  type Building = { art: TokenArt; fromOwnPrinting: boolean; madeBy: string[]; boards: Board[] };
  const tokens = new Map<string, Building>();
  // The maybeboard's cards are counted nowhere: no tokens for them (design doc 32).
  for (const maker of makers.filter((card) => isCounted(card.board))) {
    // Each token this card makes, with the art its own printing links to, if any.
    const byToken = new Map<string, TokenLinkRow[]>();
    for (const link of linksByCard.get(maker.oracleId) ?? []) {
      byToken.set(link.token.oracleId, [...(byToken.get(link.token.oracleId) ?? []), link]);
    }
    for (const [tokenOracleId, tokenLinks] of byToken) {
      const own = tokenLinks.find((link) => link.printingId === maker.printingId);
      const art = own?.token ?? newestFirst(tokenLinks.map((link) => link.token))[0];
      const known = tokens.get(tokenOracleId);
      if (known === undefined) {
        tokens.set(tokenOracleId, {
          art,
          fromOwnPrinting: own !== undefined,
          madeBy: [maker.name],
          boards: [maker.board],
        });
        continue;
      }
      // A later card's own printing beats an earlier card's guess.
      if (!known.fromOwnPrinting && own !== undefined) {
        known.art = own.token;
        known.fromOwnPrinting = true;
      }
      if (!known.madeBy.includes(maker.name)) known.madeBy.push(maker.name);
      if (!known.boards.includes(maker.board)) known.boards.push(maker.board);
    }
  }

  return [...tokens.entries()]
    .map(([oracleId, building]): TokenLine => {
      const choice = choiceFor.get(oracleId);
      const chosenId = choice?.tokenId ?? null;
      const chosen = chosenId === null ? undefined : chosenArts.get(chosenId);
      // Invariant 3: a chosen art is always a printing of this token; anything else is ignored.
      const art = chosen !== undefined && chosen.oracleId === oracleId ? chosen : undefined;
      return {
        oracleId,
        name: building.art.name,
        madeBy: building.madeBy,
        boards: building.boards,
        art: art ?? building.art,
        defaultArtId: building.art.id,
        artChosen: art !== undefined,
        included: choice?.included ?? true,
      };
    })
    .sort(byName);
}

/** Newest first; ties by set code and number, so the order never changes between loads. */
export function newestFirst(arts: readonly TokenArt[]): TokenArt[] {
  return [...arts].sort(
    (one, other) =>
      other.releasedAt.localeCompare(one.releasedAt) ||
      one.setCode.localeCompare(other.setCode) ||
      one.collectorNumber.localeCompare(other.collectorNumber, undefined, { numeric: true }),
  );
}

function byName(one: TokenLine, other: TokenLine): number {
  return one.name.localeCompare(other.name) || one.oracleId.localeCompare(other.oracleId);
}

/** What a playtest proxy prints for a token. */
export function printedToken(art: TokenArt): PrintedCard {
  return {
    faces: art.faces,
    doubleFaced: art.hasBack,
    colors: art.colors,
    producedMana: [],
    setCode: art.setCode,
    collectorNumber: art.collectorNumber,
    artist: art.artist,
    isToken: true,
  };
}

/**
 * The token copies to print, after the cards (section 3.3): `tokenCopies` of each token you
 * left in, by name. "No sideboard" leaves out tokens only sideboard cards make. "Leave out real
 * cards" doesn't touch tokens: a real Krenko still needs Goblins.
 */
export function tokensToPrint(tokens: readonly TokenLine[], options: ProxyOptions): ProxyCard[] {
  return tokens
    .filter((token) => token.included)
    .filter((token) => options.cards === "all" || token.boards.some((board) => isPlayed(board)))
    .flatMap((token) => {
      const card: ProxyCard = {
        printingId: token.art.id,
        name: token.name,
        hasBack: token.art.hasBack && options.backFaces === "pages",
        isFoil: false,
        printed: printedToken(token.art),
      };
      return Array.from({ length: options.tokenCopies }, () => card);
    });
}

/** A token's one-line summary for the print page: "Token Creature — Goblin · 1/1". */
export function tokenDescription(art: TokenArt): string {
  const [front] = art.faces;
  if (front === undefined) return "";
  const stats =
    front.power !== null && front.toughness !== null ? `${front.power}/${front.toughness}` : null;
  return [front.typeLine, stats].filter((part) => part !== null && part !== "").join(" · ");
}

/** Everything the sheet prints, in order: the deck's cards, then its tokens. */
export function sheetCards(
  lines: readonly ProxyLine[],
  tokens: readonly TokenLine[],
  options: ProxyOptions,
): ProxyCard[] {
  return [...cardsToPrint(lines, options), ...tokensToPrint(tokens, options)];
}

/** Classification of an auxiliary card produced by a deck (design doc 42). */
export const TOKEN_KINDS = ["token", "emblem", "helper"] as const;
export type TokenKind = (typeof TOKEN_KINDS)[number];

/** Counts across a deck's token, emblem, and helper checklist. */
export type TokenChecklistSummary = Readonly<{
  total: number;
  tokens: number;
  emblems: number;
  helpers: number;
  mainboard: number;
  sideboardOnly: number;
}>;

/** Checklist entry derived from a TokenLine, ready for UI and MCP responses. */
export type TokenChecklistItem = Readonly<{
  oracleId: string;
  name: string;
  kind: TokenKind;
  description: string;
  /** Rules text from the card's faces (especially useful for emblems and helper cards). */
  text: string;
  colors: readonly string[];
  hasBack: boolean;
  madeBy: readonly string[];
  boards: readonly Board[];
  sideboardOnly: boolean;
  includedInProxies: boolean;
  art: TokenArt;
}>;

/** Classifies a token printing by its front type line (case-insensitive word match). */
export function tokenKind(art: TokenArt): TokenKind {
  const typeLine = art.faces[0]?.typeLine ?? "";
  if (/\bemblem\b/i.test(typeLine)) return "emblem";
  if (/\btoken\b/i.test(typeLine)) return "token";
  return "helper";
}

/** Combined non-empty rules text across the token's faces, separated by ` // `, or "". */
export function tokenRulesText(art: TokenArt): string {
  return art.faces
    .map((face) => face.text.trim())
    .filter((text) => text !== "")
    .join(" // ");
}

/** Maps a TokenLine into a checklist item with kind, rules text, and sideboard-only flag. */
export function toTokenChecklistItem(line: TokenLine): TokenChecklistItem {
  return {
    oracleId: line.oracleId,
    name: line.name,
    kind: tokenKind(line.art),
    description: tokenDescription(line.art),
    text: tokenRulesText(line.art),
    colors: line.art.colors,
    hasBack: line.art.hasBack,
    madeBy: line.madeBy,
    boards: line.boards,
    sideboardOnly: line.boards.every((board) => !isPlayed(board)),
    includedInProxies: line.included,
    art: line.art,
  };
}

/** Summarizes token, emblem, helper, mainboard, and sideboard-only counts across lines. */
export function summarizeTokenChecklist(lines: readonly TokenLine[]): TokenChecklistSummary {
  let tokens = 0;
  let emblems = 0;
  let helpers = 0;
  let mainboard = 0;
  let sideboardOnly = 0;
  for (const line of lines) {
    const kind = tokenKind(line.art);
    if (kind === "token") tokens += 1;
    else if (kind === "emblem") emblems += 1;
    else helpers += 1;

    if (line.boards.some((board) => isPlayed(board))) mainboard += 1;
    else sideboardOnly += 1;
  }
  return {
    total: lines.length,
    tokens,
    emblems,
    helpers,
    mainboard,
    sideboardOnly,
  };
}

/** Filters checklist items by optional kind and board scope ("played" excludes sideboard-only). */
export function filterTokenChecklist(
  items: readonly TokenChecklistItem[],
  filter: { kind?: TokenKind | "all"; board?: "all" | "played" },
): TokenChecklistItem[] {
  return items.filter((item) => {
    if (filter.kind !== undefined && filter.kind !== "all" && item.kind !== filter.kind) {
      return false;
    }
    if (filter.board === "played" && item.sideboardOnly) {
      return false;
    }
    return true;
  });
}
