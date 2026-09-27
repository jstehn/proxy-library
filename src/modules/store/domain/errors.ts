// Every expected failure in the store module.
export type Forbidden = Readonly<{ kind: "Forbidden" }>;
/** No such product, its set isn't enabled, or it has no MSRP (design doc 06, rules 1–2). */
export type ProductNotForSale = Readonly<{ kind: "ProductNotForSale" }>;
export type ProductNotFound = Readonly<{ kind: "ProductNotFound" }>;
export type QuantityInvalid = Readonly<{ kind: "QuantityInvalid"; max: number }>;
export type PriceInvalid = Readonly<{ kind: "PriceInvalid"; reason: string }>;
