// The wishlist module's public reads (design doc 67), bound into `reads.wishlist` by
// `src/server/reads.ts`. `export *` keeps "Go to definition" on the SQL; only reads are exported.
// `for-sale.ts` is a helper, so it is not listed.
export * from "./wishlist";
