import type { Finish, CardFacts, CardIdentity, Tag, Theme } from "@/shared/kernel";
import type { CardRules } from "./rules";

// A card as the builder's grid and the suggestions show it (design doc 19).

export type BrowseCard = CardIdentity &
  Pick<CardFacts, "name" | "manaCost" | "manaValue" | "typeLine"> &
  Readonly<{
    /**
     * Copies counted as owned in this deck: game copies, plus real ones when it uses them. Zero for
     * a card you don't own (only when browsing every card).
     */
    owned: number;
    /** How many of `owned` are real copies (design doc 16). */
    ownedReal: number;
    inThisDeck: number;
    /** How many of your other decks use this card (ownership is shared between decks). */
    otherDecks: number;
    /** Copies owned that none of your other decks uses (task 42). */
    free: number;
    /** Why it doesn't fit this deck, or null if it does. */
    misfit: "color" | "legality" | null;
    /**
     * What the deck rules need, so the builder can check a card the moment it's added (design doc
     * 19, section 5.3). Legalities hold only the deck's format.
     */
    rules: CardRules;
    /** The rest of a provisional deck line, shown until the server answers. */
    producedMana: string[];
    roles: readonly Tag[];
    themes: readonly Theme[];
    text: string;
    /** On Wizards' Game Changer list (design doc 31). */
    isGameChanger: boolean;
    setCode: string;
    collectorNumber: string;
    finish: Finish;
    priceCents: number | null;
  }>;
