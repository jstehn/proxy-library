import type { PrintingId } from "@/modules/catalog";
import type { Finish } from "@/shared/kernel";

// Every expected failure in the collection module.

/** Tried to give up more copies than the player owns. */
export type NotEnoughCopies = Readonly<{
  kind: "NotEnoughCopies";
  printingId: PrintingId;
  finish: Finish;
  owned: number;
  needed: number;
}>;
