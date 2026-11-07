import type { Finish } from "@/modules/catalog";

// Every expected failure in the wishlist module (design doc 26, section 5).

/** Rule 3: a quantity, target price or note out of range, with what to fix. */
export type InvalidWish = Readonly<{ kind: "InvalidWish"; reason: string }>;
export type CardNotFound = Readonly<{ kind: "CardNotFound" }>;
/** Rule 4: that printing was never made in that finish. */
export type FinishNotAvailable = Readonly<{ kind: "FinishNotAvailable"; finishes: Finish[] }>;
/** Rule 2. */
export type WishlistFull = Readonly<{ kind: "WishlistFull"; max: number }>;
/** No such wish, or it isn't yours (rule 5: the same answer, so ids reveal nothing). */
export type WishNotFound = Readonly<{ kind: "WishNotFound" }>;
/** You already own the copies you wanted. */
export type AlreadyOwned = Readonly<{ kind: "AlreadyOwned" }>;
/** The printing chosen to buy isn't the card (or printing, or finish) the wish asks for. */
export type DoesNotFit = Readonly<{ kind: "DoesNotFit" }>;
/** Buy 1 up to the copies still missing. */
export type BuyQuantityInvalid = Readonly<{ kind: "BuyQuantityInvalid"; max: number }>;
