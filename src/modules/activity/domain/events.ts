import type { Finish, PrintingId } from "@/modules/catalog";
import type { UserId } from "@/shared/kernel";

// What the activity feed records (design doc 11, section 2). Money amounts other than card prices
// are never recorded: they stay private.

export type PulledCard = Readonly<{
  printingId: PrintingId;
  name: string;
  finish: Finish;
  rarity: string;
  priceCents: number | null;
}>;

export type ActivityEvent =
  | Readonly<{ kind: "pull"; actorId: UserId; itemName: string; cards: readonly PulledCard[] }>
  | Readonly<{ kind: "purchase"; actorId: UserId; productName: string; quantity: number }>
  | Readonly<{
      kind: "trade";
      actorId: UserId; // the player who accepted
      otherId: UserId;
      cardsMoved: number;
      moneyChanged: boolean;
    }>
  // A finished draft (design doc 17). Picks aren't posted: too many, and they'd reveal choices.
  | Readonly<{ kind: "draft"; actorId: UserId; setName: string; players: number }>
  // A deck shared with the playgroup for the first time (design doc 21).
  | Readonly<{
      kind: "deckShared";
      actorId: UserId;
      deckId: number;
      deckName: string;
      format: string;
    }>
  // A comment on someone else's deck; `otherId` is the deck's owner (design doc 21).
  | Readonly<{
      kind: "deckComment";
      actorId: UserId;
      otherId: UserId;
      deckId: number;
      deckName: string;
    }>;

/** Events about a player's own library, which a reset forgets (design docs 12 and 21). */
export const LIBRARY_EVENT_KINDS = ["pull", "purchase", "deckShared"] as const;

export const NOTABLE_PRICE_CENTS = 500;

/** A pull worth telling everyone about: rare or better, or worth $5 or more (the opener's "hit"). */
export function isNotable(card: Pick<PulledCard, "rarity" | "priceCents">): boolean {
  const isRareOrBetter = card.rarity !== "common" && card.rarity !== "uncommon";
  return isRareOrBetter || (card.priceCents ?? 0) >= NOTABLE_PRICE_CENTS;
}
