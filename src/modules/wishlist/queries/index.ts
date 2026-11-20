// The wishlist module's public reads (design doc 67), bound into `reads.wishlist` by
// `src/server/reads.ts`. `export *` keeps "Go to definition" on the SQL; only reads are exported.
// `for-sale.ts` and `of-user.ts` are helpers, so they are not listed.
export * from "./wishlist";
