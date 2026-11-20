import type { CardFacts } from "@/shared/kernel";

/** What the bracket rules read: a card's type line and text, and the mana it makes. */
export type TagFacts = Pick<CardFacts, "typeLine" | "text"> &
  Partial<Pick<CardFacts, "producedMana">>;

/**
 * Bumped whenever BRACKET_TEXT_RULES (./brackets.ts) changes: the catalog sync then works out every
 * printing's stored bracket flags again (design doc 20, invariant 1). The themes and role tags
 * moved to the catalog's card features (FEATURES_VERSION).
 */
export const CARD_FEATURES_VERSION = 4;
