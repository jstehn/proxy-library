import type { PrintingId } from "@/modules/catalog";
import { type Clock, type Finish, type UnitOfWork, type UserId } from "@/shared/kernel";
import type { Deck, DeckId, DeckOrigin, Format, PrintingFacts } from "../domain/deck";

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
