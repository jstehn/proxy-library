import type { Actor } from "@/modules/accounts";
import { err, ok, type Result, type UnitOfWork } from "@/shared/kernel";
import type { DeckId } from "../domain/deck";
import type { DeckNotFound, NotThatToken, TokenNotInDeck } from "../domain/errors";
import type { TokenChoiceServices } from "./ports";

// Choosing a token's art, or leaving it out, for one deck's proxies (design doc 25).

export type ChooseTokenError = DeckNotFound | TokenNotInDeck | NotThatToken;

export type ChooseTokenInput = Readonly<{
  deckId: DeckId;
  tokenOracleId: string;
  /** The token printing to print, or null for the default art. */
  tokenId: string | null;
  /** Whether the token prints at all. */
  included: boolean;
}>;

export type TokenChoicesDependencies = { unitOfWork: UnitOfWork<TokenChoiceServices> };

export function makeTokenChoices(dependencies: TokenChoicesDependencies) {
  const { unitOfWork } = dependencies;

  /**
   * Saves your art and "print it" choice for one of the deck's tokens. Only the deck's owner may,
   * only for a token its cards make, and only with an art of that token (invariant 3).
   */
  async function chooseToken(
    actor: Actor,
    input: ChooseTokenInput,
  ): Promise<Result<void, ChooseTokenError>> {
    return unitOfWork.run<void, ChooseTokenError>(async ({ decks, deckTokens }) => {
      const deck = await decks.lockOwned(input.deckId, actor.userId);
      if (deck === null) return err({ kind: "DeckNotFound" });
      const cardOracleIds = deck.entries.map((entry) => entry.oracleId);
      if (!(await deckTokens.anyMakes(cardOracleIds, input.tokenOracleId))) {
        return err({ kind: "TokenNotInDeck" });
      }
      if (input.tokenId !== null) {
        const tokenOracleId = await deckTokens.tokenOracleOf(input.tokenId);
        if (tokenOracleId !== input.tokenOracleId) return err({ kind: "NotThatToken" });
      }
      await deckTokens.saveChoice(deck.id, {
        tokenOracleId: input.tokenOracleId,
        tokenId: input.tokenId,
        included: input.included,
      });
      return ok();
    });
  }

  return chooseToken;
}

export type ChooseToken = ReturnType<typeof makeTokenChoices>;
