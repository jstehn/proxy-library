// The decks module's public reads (design doc 67), bound into `reads.decks` by
// `src/server/reads.ts`. `reads.ts` holds the player reads (they take the `Actor`); the others are
// listed by name because their files also hold queries that are not reads for players (the ones
// a capability in this module calls with a plain `userId`, design doc 67 section 7B), and
// `export *` would offer those too. `public.ts` holds what a visitor may call (`PublicReads`).
export * from "./reads";
export { deckForViewer, deckComments, sharedDecks } from "@/modules/decks/core";
export { tokenArtOptions } from "@/modules/decks/proxies";
