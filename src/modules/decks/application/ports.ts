import type { ActivityServices } from "@/modules/activity";
import type { Finish, PrintingId } from "@/modules/catalog";
import type { Clock, UnitOfWork, UserId } from "@/shared/kernel";
import type { Deck, DeckId, DeckOrigin, Format, PrintingFacts } from "../domain/deck";
import type { ProxyProgress } from "../domain/proxy-progress";
import type { ProxyOptions, ProxyPage } from "../domain/proxy-sheet";
import type { CommentId, DeckComment, DeckForSharing, Visibility } from "../domain/sharing";
import type { DeckSnapshot, SnapshotId } from "../domain/snapshots";
import type { TokenChoice } from "../domain/token-proxies";

// Ports: what the deck use cases need from outside (design doc 09, section 6).

export type CopyDeckSource =
  | Readonly<{ kind: "deck"; deckId: DeckId; viewerId: UserId }>
  | Readonly<{ kind: "publicToken"; token: string }>;

export interface DeckRepository {
  create(input: {
    ownerId: UserId;
    name: string;
    format: Format;
    origin?: DeckOrigin | null;
    /** Defaults to on (design doc 16). */
    usesRealCards?: boolean;
    at: Date;
  }): Promise<DeckId>;
  countFor(ownerId: UserId): Promise<number>;
  /** The deck, locked until the transaction ends, if it exists and belongs to this player. */
  lockOwned(deckId: DeckId, ownerId: UserId): Promise<Deck | null>;
  /** A deck the caller may read (owned, shared, or matching public token), or null. */
  findReadable(source: CopyDeckSource): Promise<Deck | null>;
  /**
   * Saves the name, format, settings and every entry (replacing the old entries), with the
   * headings tidied to match the entries (`tidyHeadings`, design doc 34).
   */
  save(deck: Deck, at: Date): Promise<void>;
  delete(deckId: DeckId): Promise<void>;
  /** Deletes every deck a player has. Returns how many. */
  deleteAllOf(ownerId: UserId): Promise<number>;
  /** How many saved snapshots this deck has (design doc 41). */
  countSnapshots(deckId: DeckId): Promise<number>;
  /** Saves a point-in-time snapshot of a deck and returns its new id. */
  saveSnapshot(snapshot: Omit<DeckSnapshot, "id">): Promise<SnapshotId>;
  /** One saved snapshot belonging to this deck, or null if absent. */
  getSnapshot(deckId: DeckId, snapshotId: SnapshotId): Promise<DeckSnapshot | null>;
  /** Deletes a snapshot belonging to this deck; returns false if it wasn't there. */
  deleteSnapshot(deckId: DeckId, snapshotId: SnapshotId): Promise<boolean>;
}

/** A card named in a pasted list, found in the catalog. */
export type ResolvedCard = Readonly<{
  oracleId: string;
  printingId: PrintingId;
  finish: Finish;
  /** True when this is the printing the line asked for ("(C21) 263"), not a stand-in. */
  namedPrinting: boolean;
}>;

/**
 * Which printing a line that names no printing (and that you own no copy of) gets: the card's
 * standard printing (design doc 24), or its cheapest one in the store, so a deck built to buy
 * costs as little as it can.
 */
export type UnnamedPrinting = "standard" | "cheapest";

/** How to choose a printing for each line of a list. */
export type ResolveOptions = Readonly<{
  /** Whose copies count: game ones, plus real ones if the deck uses them. */
  includeReal: boolean;
  /** The printing for an unowned line that names none. */
  unnamedPrinting: UnnamedPrinting;
}>;

export type CardQuery = Readonly<{
  name: string;
  setCode: string | null;
  collectorNumber: string | null;
}>;

export interface CardLookup {
  /** Whether the catalog has this oracle card. */
  exists(oracleId: string): Promise<boolean>;
  /** A printing's card and the finishes it comes in, or null if the catalog lacks it. */
  printingFacts(printingId: PrintingId): Promise<PrintingFacts | null>;
  /** The oracle card of each printing (unknown printings are missing from the map). */
  oracleIdsOf(printingIds: readonly PrintingId[]): Promise<Map<PrintingId, string>>;
  /** Which of these oracle cards exist in the catalog (for snapshot restores). */
  existingOracleIds(oracleIds: readonly string[]): Promise<Set<string>>;
  /** Which of these printing ids still exist in the catalog (for snapshot restores). */
  existingPrintings(printingIds: readonly PrintingId[]): Promise<Set<PrintingId>>;
  /**
   * Finds each named card (matching front-face names too), preferring the exact printing asked
   * for, then this player's most special copy (design doc 23, section 14), then the card's
   * standard printing (design doc 24). Missing names are left out.
   */
  resolve(
    ownerId: UserId,
    queries: readonly CardQuery[],
    options: ResolveOptions,
  ): Promise<Map<number, ResolvedCard>>;
}

export type DecksServices = { decks: DeckRepository; cards: CardLookup };

export type DecksDependencies = { unitOfWork: UnitOfWork<DecksServices>; clock: Clock };

/** Tokens a deck's cards make, and the deck's choices for them (design doc 25). */
export interface DeckTokenRepository {
  /** The token a token printing is of, or null if the catalog doesn't have it. */
  tokenOracleOf(tokenId: string): Promise<string | null>;
  /** Whether any printing of any of these cards makes this token. */
  anyMakes(cardOracleIds: readonly string[], tokenOracleId: string): Promise<boolean>;
  /** Saves (or replaces) the deck's choice for one token. */
  saveChoice(deckId: DeckId, choice: TokenChoice): Promise<void>;
}

export type TokenChoiceServices = { decks: DeckRepository; deckTokens: DeckTokenRepository };

/** Card images for proxy sheets (the catalog's image cache, wired in core.ts). */
export interface ProxyImageSource {
  /** The large image's bytes (JPEG), or null when the card has no image of that face. */
  image(printingId: string, face: "front" | "back"): Promise<Uint8Array | null>;
  /** Just the illustration (Scryfall's art crop, JPEG), for playtest proxies (design doc 22). */
  artCrop(printingId: string, face: "front" | "back"): Promise<Uint8Array | null>;
}

/**
 * Draws laid-out proxy pages as a PDF. Images are keyed by `proxyImageKey`: the card scans, or
 * for the playtest style, the art crops.
 */
export interface ProxyPdfRenderer {
  render(
    pages: readonly ProxyPage[],
    images: ReadonlyMap<string, Uint8Array>,
    options: ProxyOptions,
    /** Called after each page is drawn, and before the file is saved. */
    onProgress?: (progress: ProxyProgress) => void,
  ): Promise<Uint8Array>;
}

export type ProxySheetsDependencies = { images: ProxyImageSource; renderer: ProxyPdfRenderer };

/** Sharing decks and commenting on them (design doc 21, section 6). */
export interface DeckSharingRepository {
  /** The deck, locked until the transaction ends, or null if there's no such deck. */
  lockDeck(deckId: DeckId): Promise<DeckForSharing | null>;
  setVisibility(deckId: DeckId, visibility: Visibility, firstSharedAt: Date | null): Promise<void>;
  setPublicToken(deckId: DeckId, publicToken: string | null): Promise<void>;
  addComment(input: {
    deckId: DeckId;
    authorId: UserId;
    body: string;
    at: Date;
  }): Promise<CommentId>;
  /** The comment, locked, with its deck's owner, or null. */
  lockComment(commentId: CommentId): Promise<(DeckComment & { deckOwnerId: UserId }) | null>;
  markDeleted(commentId: CommentId, deletedBy: UserId, at: Date): Promise<void>;
}

export type DeckSharingServices = { deckSharing: DeckSharingRepository } & ActivityServices;

export type DeckSharingDependencies = {
  unitOfWork: UnitOfWork<DeckSharingServices>;
  clock: Clock;
  tokens: Readonly<{ newPublicToken(): string }>;
};
