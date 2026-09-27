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
    }>;

export const NOTABLE_PRICE_CENTS = 500;

/** A pull worth telling everyone about: rare or better, or worth $5 or more (the opener's "hit"). */
export function isNotable(card: Pick<PulledCard, "rarity" | "priceCents">): boolean {
  const isRareOrBetter = card.rarity !== "common" && card.rarity !== "uncommon";
  return isRareOrBetter || (card.priceCents ?? 0) >= NOTABLE_PRICE_CENTS;
}
