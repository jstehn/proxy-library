"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { PrintingId } from "@/modules/catalog";
import { DeckId, FORMATS, type Format } from "@/modules/decks";
import { VISIBILITIES, type SectionVisibility } from "@/modules/social";
import { COLORS } from "@/shared/mtg";
import type { ManaColor } from "@/shared/mtg";
import { parseForm } from "@/server/form-action";
import { readPage } from "@/server/page-instance";
import { playerPath, revalidateProfile } from "../paths";

export type ProfileFormState = { error: string | null };

const ProfileForm = z.object({
  bio: z.string().default(""),
  favoriteColors: z.array(z.string()).default([]),
  favoriteFormats: z.array(z.string()).default([]),
  showcaseDeckId: z.string().default(""),
  showcaseCard1: z.string().default(""),
  showcaseCard2: z.string().default(""),
  showcaseCard3: z.string().default(""),
  statsVisibility: z.string().default("everyone"),
  wishlistVisibility: z.string().default("friends"),
});

export async function saveProfileAction(
  _prev: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const { actor, capabilities } = await readPage();
  // Every field has a default, so the form always reads; a value that isn't one of ours falls back below.
  const form = parseForm(ProfileForm, formData);
  if (!form.success) return { error: "Please check the form and try again." };
  const { bio, showcaseCard1, showcaseCard2, showcaseCard3 } = form.data;

  const favoriteColors = form.data.favoriteColors.filter((c): c is ManaColor =>
    (COLORS as readonly string[]).includes(c),
  );
  const favoriteFormats = form.data.favoriteFormats.filter((f): f is Format =>
    (FORMATS as readonly string[]).includes(f),
  );

  const rawDeckId = form.data.showcaseDeckId.trim();
  let showcaseDeckId: DeckId | null = null;
  if (rawDeckId !== "") {
    const parsed = Number(rawDeckId);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      return { error: "Invalid showcase deck selection." };
    }
    showcaseDeckId = DeckId.of(parsed);
  }

  const rawCards = [showcaseCard1, showcaseCard2, showcaseCard3]
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  const showcasePrintingIds = rawCards.map(PrintingId.of);

  const rawStatsVis = form.data.statsVisibility;
  const rawWishlistVis = form.data.wishlistVisibility;
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

  const result = await capabilities.social.updateProfile(actor.userId, {
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

  revalidateProfile(actor);
  redirect(playerPath(actor.username));
}
