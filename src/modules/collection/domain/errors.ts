import type { Finish, PrintingId } from "@/modules/catalog";

// Every expected failure in the collection module.

/** Tried to give up more copies than the player owns. */
export type NotEnoughCopies = Readonly<{
  kind: "NotEnoughCopies";
  printingId: PrintingId;
  finish: Finish;
  owned: number;
  needed: number;
}>;
