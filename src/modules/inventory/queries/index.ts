// The inventory module's public reads (design doc 67), bound into `reads.inventory` by
// `src/server/reads.ts`. `export *` keeps "Go to definition" on the SQL; only reads are exported.
export * from "./inventory";
