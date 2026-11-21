// The decks reads a visitor (no one signed in) may call (design doc 67, kind V): the credential is
// a shared deck's link token. `src/server/reads.ts` binds them with `bindPublicDb`, so none of them
// can take a player or a deck number.
export { publicDeck } from "@/modules/decks/sharing";
export { publicScorecard } from "./scorecard";
export { publicDeckTokens } from "@/modules/decks/proxies";
