"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { PrintingId } from "@/modules/catalog";
import { DeckId, FORMATS, type Format } from "@/modules/decks";
import { MANA_COLORS, VISIBILITIES, type SectionVisibility } from "@/modules/social";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import type { ManaColor } from "@/shared/kernel";

export type ProfileFormState = { error: string | null };

export async function saveProfileAction(
  _prev: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const actor = await requireActor();
  const bio = String(formData.get("bio") ?? "");

  const rawColors = formData.getAll("favoriteColors").map(String);
  const favoriteColors = rawColors.filter((c): c is ManaColor =>
    (MANA_COLORS as readonly string[]).includes(c),
  );

  const rawFormats = formData.getAll("favoriteFormats").map(String);
  const favoriteFormats = rawFormats.filter((f): f is Format =>
    (FORMATS as readonly string[]).includes(f),
  );

  const rawDeckId = String(formData.get("showcaseDeckId") ?? "").trim();
  let showcaseDeckId: DeckId | null = null;
  if (rawDeckId !== "") {
    const parsed = Number(rawDeckId);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      return { error: "Invalid showcase deck selection." };
    }
    showcaseDeckId = DeckId.of(parsed);
  }

  const rawCards = [
    String(formData.get("showcaseCard1") ?? "").trim(),
    String(formData.get("showcaseCard2") ?? "").trim(),
    String(formData.get("showcaseCard3") ?? "").trim(),
  ].filter((id) => id.length > 0);
  const showcasePrintingIds = rawCards.map(PrintingId.of);

  const rawStatsVis = String(formData.get("statsVisibility") ?? "everyone");
  const rawWishlistVis = String(formData.get("wishlistVisibility") ?? "friends");
  const statsVisibility: SectionVisibility = (VISIBILITIES as readonly string[]).includes(
    rawStatsVis,
  )
    ? (rawStatsVis as SectionVisibility)
    : "everyone";
  const wishlistVisibility: SectionVisibility = (VISIBILITIES as readonly string[]).includes(
    rawWishlistVis,
  )
    ? (rawWishlistVis as SectionVisibility)
    : "friends";

  const result = await getContainer().social.updateProfile(actor.userId, {
    bio,
    favoriteColors,
    favoriteFormats,
    showcaseDeckId,
    showcasePrintingIds,
    statsVisibility,
    wishlistVisibility,
  });

  if (!result.ok) {
    switch (result.error.kind) {
      case "BioTooLong":
        return { error: `Bio must be ${result.error.max} characters or fewer.` };
      case "TooManyShowcaseCards":
        return { error: `You can showcase at most ${result.error.max} cards.` };
      case "InvalidShowcaseDeck":
        return { error: "Showcase deck must be one of your shared decks." };
      case "InvalidShowcaseCard":
        return { error: "One or more showcase card printing IDs were not found." };
    }
  }

  revalidatePath(`/players/${actor.username}`);
  revalidatePath(`/players/${actor.userId}`);
  revalidatePath("/account/profile");
  revalidatePath("/friends");
  redirect(`/players/${actor.username}`);
}
