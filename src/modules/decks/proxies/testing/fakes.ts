import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DeckId } from "@/modules/decks/core/client";
import type { DeckTokenRepository, ProxyImageSource } from "../application/ports";
import type { TokenChoice } from "../domain/token-proxies";

/** A token printing the fake catalog has, and the cards (oracle ids) that make it. */
export type SampleToken = Readonly<{ tokenId: string; tokenOracleId: string; madeBy: string[] }>;

/** Tokens the catalog "has", and the choices saved, readable with `choicesOf`. */
export function inMemoryDeckTokens(tokens: readonly SampleToken[]) {
  const choices = new Map<DeckId, Map<string, TokenChoice>>();
  const repository: DeckTokenRepository = {
    async tokenOracleOf(tokenId) {
      return tokens.find((token) => token.tokenId === tokenId)?.tokenOracleId ?? null;
    },
    async anyMakes(cardOracleIds, tokenOracleId) {
      return tokens.some(
        (token) =>
          token.tokenOracleId === tokenOracleId &&
          token.madeBy.some((oracleId) => cardOracleIds.includes(oracleId)),
      );
    },
    async saveChoice(deckId, choice) {
      const forDeck = choices.get(deckId) ?? new Map<string, TokenChoice>();
      forDeck.set(choice.tokenOracleId, choice);
      choices.set(deckId, forDeck);
    },
  };
  return {
    ...repository,
    choicesOf: (deckId: DeckId) => [...(choices.get(deckId)?.values() ?? [])],
  };
}

/** A real 8 × 8 JPEG (one blue square, drawn by Chromium), to stand in for card images. */
const TINY_JPEG = new Uint8Array(
  readFileSync(join(process.cwd(), "tests/fixtures/images/card.jpg")),
);

/**
 * Card images from memory: every printing has a front; only those in `withBacks` have a back.
 * Remembers what was asked for, to check each image is fetched once.
 */
export function fakeProxyImages(withBacks: readonly string[] = []) {
  const requests: string[] = [];
  const images: ProxyImageSource = {
    async image(printingId, face) {
      requests.push(`${printingId}/${face}`);
      return face === "front" || withBacks.includes(printingId) ? TINY_JPEG : null;
    },
    async artCrop(printingId, face) {
      requests.push(`art:${printingId}/${face}`);
      return face === "front" || withBacks.includes(printingId) ? TINY_JPEG : null;
    },
  };
  return { images, requests };
}
