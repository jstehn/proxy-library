"use server";
import { z } from "zod";
import { DeckId, type TokenArt, type TokenLine } from "@/modules/decks";
import { readPage } from "@/server/page-instance";

// The print page's token section (design doc 25): every art of a token, and saving your choice.

const DeckIdInput = z.number().int().positive();

const TokenArtsInput = z.object({ tokenOracleId: z.string().min(1) });

/** Every art of one token, newest first, for the art picker. */
export async function tokenArtsAction(
  input: z.input<typeof TokenArtsInput>,
): Promise<TokenArt[] | null> {
  const { capabilities } = await readPage();
  const parsed = TokenArtsInput.safeParse(input);
  if (!parsed.success) return null;
  return capabilities.deckReads.tokenArtOptions(parsed.data.tokenOracleId);
}

const ChooseTokenInput = z.object({
  deckId: DeckIdInput,
  tokenOracleId: z.string().min(1),
  /** null: the default art. */
  tokenId: z.string().min(1).nullable(),
  included: z.boolean(),
});

export type ChooseTokenResult =
  Readonly<{ ok: true; tokens: TokenLine[] }> | Readonly<{ ok: false; message: string }>;

/** Saves a token's art and whether it prints; returns the deck's tokens, fresh. */
export async function chooseTokenAction(
  input: z.input<typeof ChooseTokenInput>,
): Promise<ChooseTokenResult> {
  const { actor, capabilities } = await readPage();
  const parsed = ChooseTokenInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That change wasn't understood." };
  const { deckId, tokenOracleId, tokenId, included } = parsed.data;
  const result = await capabilities.chooseToken(actor, {
    deckId: DeckId.of(deckId),
    tokenOracleId,
    tokenId,
    included,
  });
  if (!result.ok) {
    const messages: Record<(typeof result.error)["kind"], string> = {
      DeckNotFound: "That deck isn't yours.",
      TokenNotInDeck: "No card in the deck makes that token any more.",
      NotThatToken: "That art is of another token.",
    };
    return { ok: false, message: messages[result.error.kind] };
  }
  const deck = await capabilities.proxyDeck(actor.userId, deckId);
  return deck === null
    ? { ok: false, message: "That deck isn't yours." }
    : { ok: true, tokens: deck.tokens };
}
