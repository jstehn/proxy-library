import type { DeckId } from "../../domain/deck";
import type { DeckRepository } from "../../application/ports";
import type { ProxyProgress } from "../domain/proxy-progress";
import type { ProxyOptions, ProxyPage } from "../domain/proxy-sheet";
import type { TokenChoice } from "../domain/token-proxies";

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
