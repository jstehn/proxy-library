import type { Finish } from "@/modules/catalog";

// Every expected failure in the real-collection module (design doc 16, sections 6 and 15).

export type PrintingNotFound = Readonly<{ kind: "PrintingNotFound" }>;
/** Rule 4: that printing was never made in that finish. */
export type FinishNotAvailable = Readonly<{ kind: "FinishNotAvailable"; finishes: Finish[] }>;
/** Rule 3: not a whole number from 0 to 9,999. */
export type QuantityInvalid = Readonly<{ kind: "QuantityInvalid" }>;
/** The player has no copies in the row they tried to change. */
export type NotOwned = Readonly<{ kind: "NotOwned" }>;
/** A row can only move to another printing of the same card. */
export type NotTheSameCard = Readonly<{ kind: "NotTheSameCard" }>;
/** Nothing to import: no lines, or no line that matched a card. */
export type ImportEmpty = Readonly<{ kind: "ImportEmpty" }>;
/** Rule 8: more than 20,000 lines or 5 MB. */
export type ImportTooLarge = Readonly<{
  kind: "ImportTooLarge";
  maxLines: number;
  maxBytes: number;
}>;
/** A CSV file, but not one of the formats we read. */
export type FormatNotRecognized = Readonly<{ kind: "FormatNotRecognized" }>;
/** Rule 6: the collection changed after the preview, so the preview must be made again. */
export type CollectionChanged = Readonly<{ kind: "CollectionChanged" }>;
export type ProductNotFound = Readonly<{ kind: "ProductNotFound" }>;
/** Something the product contains is missing from the catalog. */
export type ProductUnavailable = Readonly<{ kind: "ProductUnavailable" }>;
/**
 * The product holds "one of these" (a variable node) and the player hasn't said which one they
 * got. `index` is which choice this is (in the order they're met), `options` names each one.
 */
export type ChoiceNeeded = Readonly<{ kind: "ChoiceNeeded"; index: number; options: string[] }>;
