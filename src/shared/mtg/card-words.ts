// The basic words every module shares, each with one type and one `as const` array (refactor P02).
// Zod schemas for them are in ./schemas.ts.

/** How a printing is finished. */
export const FINISHES = ["nonfoil", "foil", "etched"] as const;
export type Finish = (typeof FINISHES)[number];

export const RARITIES = ["common", "uncommon", "rare", "mythic", "special", "bonus"] as const;
export type Rarity = (typeof RARITIES)[number];
