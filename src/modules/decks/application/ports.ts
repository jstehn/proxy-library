import type { Finish, PrintingId } from "@/modules/catalog";
import type { Clock, UnitOfWork, UserId } from "@/shared/kernel";
import type { Deck, DeckId, DeckOrigin, Format } from "../domain/deck";
import type { ProxyPage } from "../domain/proxy-sheet";

// Ports: what the deck use cases need from outside (design doc 09, section 6).

export interface DeckRepository {
  create(input: {
    ownerId: UserId;
    name: string;
    format: Format;
    origin?: DeckOrigin | null;
    at: Date;
  }): Promise<DeckId>;
  countFor(ownerId: UserId): Promise<number>;
  /** The deck, locked until the transaction ends, if it exists and belongs to this player. */
  lockOwned(deckId: DeckId, ownerId: UserId): Promise<Deck | null>;
  /** Saves the name, format and every entry (replacing the old entries). */
  save(deck: Deck, at: Date): Promise<void>;
  delete(deckId: DeckId): Promise<void>;
  /** Deletes every deck a player has. Returns how many. */
  deleteAllOf(ownerId: UserId): Promise<number>;
}

/** A card named in a pasted list, found in the catalog. */
export type ResolvedCard = Readonly<{ oracleId: string; printingId: PrintingId; finish: Finish }>;

export type CardQuery = Readonly<{
  name: string;
  setCode: string | null;
  collectorNumber: string | null;
}>;

export interface CardLookup {
  /** Whether the catalog has this oracle card. */
  exists(oracleId: string): Promise<boolean>;
  /** The oracle card of each printing (unknown printings are missing from the map). */
  oracleIdsOf(printingIds: readonly PrintingId[]): Promise<Map<PrintingId, string>>;
  /**
   * Finds each named card (matching front-face names too), preferring the exact printing asked
   * for, then a printing this player owns, then the newest. Missing names are left out.
   */
  resolve(ownerId: UserId, queries: readonly CardQuery[]): Promise<Map<number, ResolvedCard>>;
}

export type DecksServices = { decks: DeckRepository; cards: CardLookup };

export type DecksDependencies = { unitOfWork: UnitOfWork<DecksServices>; clock: Clock };

/** Large card images for proxy sheets (the catalog's image cache, wired in core.ts). */
export interface ProxyImageSource {
  /** The image's bytes (JPEG), or null when the card has no image of that face. */
  image(printingId: string, face: "front" | "back"): Promise<Uint8Array | null>;
}

/** Draws laid-out proxy pages as a PDF. Images are keyed by `proxyImageKey`. */
export interface ProxyPdfRenderer {
  render(pages: readonly ProxyPage[], images: ReadonlyMap<string, Uint8Array>): Promise<Uint8Array>;
}

export type ProxySheetsDependencies = { images: ProxyImageSource; renderer: ProxyPdfRenderer };
