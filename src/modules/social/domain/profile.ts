import type { PrintingId } from "@/modules/catalog";
import type { DeckId, Format } from "@/modules/decks";
import { err, ok, type Result, type UserId } from "@/shared/kernel";
import { COLORS, type ManaColor } from "@/shared/mtg";
import type { ViewerRelation } from "./friendship";

export const MAX_BIO_LENGTH = 500;
export const MAX_SHOWCASE_CARDS = 3;

export const VISIBILITIES = ["everyone", "friends", "only_me"] as const;
export type SectionVisibility = (typeof VISIBILITIES)[number];

export type PlayerProfile = Readonly<{
  userId: UserId;
  bio: string;
  favoriteColors: readonly ManaColor[];
  favoriteFormats: readonly Format[];
  showcaseDeckId: DeckId | null;
  showcasePrintingIds: readonly PrintingId[];
  statsVisibility: SectionVisibility;
  wishlistVisibility: SectionVisibility;
  updatedAt: Date;
}>;

export type BioError = { kind: "BioTooLong"; max: number; actual: number };

export function checkBio(raw: string): Result<string, BioError> {
  const trimmed = raw.trim();
  if (trimmed.length > MAX_BIO_LENGTH) {
    return err({ kind: "BioTooLong", max: MAX_BIO_LENGTH, actual: trimmed.length });
  }
  return ok(trimmed);
}

export function normalizeFavoriteColors(colors: readonly ManaColor[]): readonly ManaColor[] {
  const chosen = new Set(colors);
  return COLORS.filter((color) => chosen.has(color));
}

export function normalizeFavoriteFormats(formats: readonly Format[]): readonly Format[] {
  const seen = new Set<Format>();
  const result: Format[] = [];
  for (const format of formats) {
    if (!seen.has(format)) {
      seen.add(format);
      result.push(format);
    }
  }
  return result;
}

export type ShowcaseCardsError = { kind: "TooManyShowcaseCards"; max: number; actual: number };

export function checkShowcaseCards(
  printingIds: readonly PrintingId[],
): Result<readonly PrintingId[], ShowcaseCardsError> {
  const unique: PrintingId[] = [];
  const seen = new Set<string>();
  for (const id of printingIds) {
    if (!seen.has(id)) {
      seen.add(id);
      unique.push(id);
    }
  }
  if (unique.length > MAX_SHOWCASE_CARDS) {
    return err({
      kind: "TooManyShowcaseCards",
      max: MAX_SHOWCASE_CARDS,
      actual: unique.length,
    });
  }
  return ok(unique);
}

/** Whether a viewer with `relation` may see a profile section with `visibility`. */
export function canViewSection(visibility: SectionVisibility, relation: ViewerRelation): boolean {
  if (relation === "self") return true;
  if (visibility === "everyone") return true;
  if (visibility === "friends") return relation === "friend";
  return false;
}
