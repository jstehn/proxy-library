// Zod schemas of the basic words, so each module's parsing code shares one definition (P02).
// This is the only kernel file allowed to use zod (eslint.config.mjs).
import { z } from "zod";
import { FINISHES, RARITIES } from "./card-words";
import { COLORS, MANA_SYMBOLS } from "./colors";

export const FinishSchema = z.enum(FINISHES);
export const RaritySchema = z.enum(RARITIES);
export const ColorSchema = z.enum(COLORS);
export const ManaSymbolSchema = z.enum(MANA_SYMBOLS);

/** A wish's finish: a real finish, or "cheapest" (the cheapest printing and finish for sale). */
export const FinishOrCheapestSchema = z.enum([...FINISHES, "cheapest"]);
