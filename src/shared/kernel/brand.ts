declare const brand: unique symbol;

/**
 * A nominal ("branded") type: plain `T` at runtime, but the compiler won't let one
 * brand stand in for another (a `UserId` is not a `CardId`, `Cents` is not a count).
 * Values are created only through a smart constructor that validates them.
 * See patterns.md #8.
 */
export type Brand<T, Name extends string> = T & { readonly [brand]: Name };
