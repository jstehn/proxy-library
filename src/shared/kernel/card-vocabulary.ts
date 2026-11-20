// The words that name what a card does (design doc 66): role tags here, themes and bracket flags
// as their recognizers arrive. The search parser checks `tag:` against them, and `shared/` may not
// import a module (ADR 0009), so like `COLORS` they are words every module shares.

export const TAGS = ["ramp", "draw", "removal", "wipe", "counter", "tutor", "protection"] as const;
/** A job a card does in a deck. A card can have several, or none. */
export type Tag = (typeof TAGS)[number];
