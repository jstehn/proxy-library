import type { PrintingId } from "@/modules/catalog";
import type { DeckId, Format } from "@/modules/decks";
import { err, ok, type ManaColor, type Result, type UserId } from "@/shared/kernel";
import {
  checkBio,
  checkShowcaseCards,
  normalizeFavoriteColors,
  normalizeFavoriteFormats,
  type BioError,
  type PlayerProfile,
  type SectionVisibility,
  type ShowcaseCardsError,
} from "../domain/profile";
import type { SocialDependencies } from "./ports";

export type UpdateProfileInput = Readonly<{
  bio: string;
  favoriteColors: readonly ManaColor[];
  favoriteFormats: readonly Format[];
  showcaseDeckId: DeckId | null;
  showcasePrintingIds: readonly PrintingId[];
  statsVisibility: SectionVisibility;
  wishlistVisibility: SectionVisibility;
}>;

export type UpdateProfileError =
  BioError | ShowcaseCardsError | { kind: "InvalidShowcaseDeck" } | { kind: "InvalidShowcaseCard" };

export function makeUpdateProfile({ unitOfWork, clock }: SocialDependencies) {
  return async function updateProfile(
    userId: UserId,
    input: UpdateProfileInput,
  ): Promise<Result<PlayerProfile, UpdateProfileError>> {
    const bioResult = checkBio(input.bio);
    if (!bioResult.ok) return bioResult;

    const cardsResult = checkShowcaseCards(input.showcasePrintingIds);
    if (!cardsResult.ok) return cardsResult;

    return unitOfWork.run<PlayerProfile, UpdateProfileError>(async (services) => {
      if (input.showcaseDeckId !== null) {
        const validDeck = await services.showcaseValidator.isOwnedSharedDeck(
          userId,
          input.showcaseDeckId,
        );
        if (!validDeck) return err({ kind: "InvalidShowcaseDeck" });
      }

      if (cardsResult.value.length > 0) {
        const validCards = await services.showcaseValidator.allPrintingsExist(cardsResult.value);
        if (!validCards) return err({ kind: "InvalidShowcaseCard" });
      }

      const profile: PlayerProfile = {
        userId,
        bio: bioResult.value,
        favoriteColors: normalizeFavoriteColors(input.favoriteColors),
        favoriteFormats: normalizeFavoriteFormats(input.favoriteFormats),
        showcaseDeckId: input.showcaseDeckId,
        showcasePrintingIds: cardsResult.value,
        statsVisibility: input.statsVisibility,
        wishlistVisibility: input.wishlistVisibility,
        updatedAt: clock.now(),
      };
      await services.profiles.save(profile);
      return ok(profile);
    });
  };
}
