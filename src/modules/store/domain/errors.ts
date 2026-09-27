// Every expected failure in the store module.
export type Forbidden = Readonly<{ kind: "Forbidden" }>;
/** No such product, its set isn't enabled, or it has no MSRP (design doc 06, rules 1–2). */
export type ProductNotForSale = Readonly<{ kind: "ProductNotForSale" }>;
export type ProductNotFound = Readonly<{ kind: "ProductNotFound" }>;
export type QuantityInvalid = Readonly<{ kind: "QuantityInvalid"; max: number }>;
export type PriceInvalid = Readonly<{ kind: "PriceInvalid"; reason: string }>;
/** A single that can't be bought: its set isn't enabled, or the catalog doesn't have it. */
export type NotForSale = Readonly<{ kind: "NotForSale" }>;
/** No market price for that printing in that finish (rule 1). */
export type NoPrice = Readonly<{ kind: "NoPrice" }>;
/** The payout rounds down to $0.00 (rule 4). */
export type WorthNothing = Readonly<{ kind: "WorthNothing" }>;
/** The buylist rate is 0%: the store isn't buying cards (rule 5). */
export type NotBuying = Readonly<{ kind: "NotBuying" }>;
export type RateInvalid = Readonly<{ kind: "RateInvalid" }>;
