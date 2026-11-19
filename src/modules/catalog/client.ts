// The catalog's browser-safe public API (ADR 0016): the basic words every module shares, with
// their types and Zod schemas. Client components import this; server code may use index.ts.
export { COLORS, FINISHES, RARITIES, type Color, type Finish, type Rarity } from "./domain/types";
