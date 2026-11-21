"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { PrintingId, SealedProductId } from "@/modules/catalog";
import { becomesADeck } from "@/modules/decks";
import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_LINES,
  MAX_REAL_QUANTITY,
  type ImportPreview,
  type PrintingChoice,
  type ProductDeck,
} from "@/modules/collection/real";
import { checkbox, parseForm } from "@/server/form-action";
import { formRedirect } from "@/server/form-action-instance";
import type { PageContext } from "@/server/page";
import { readPage } from "@/server/page-instance";
import { FinishSchema } from "@/shared/mtg";
import { cardPath, revalidateCard } from "../../cards/paths";
import {
  REAL_COLLECTION_PATH,
  realCollectionMessagePath,
  revalidateRealCollection,
  revalidateStoreSetPages,
} from "./paths";

// Server actions for the real collection (design doc 16, sections 7 and 15). The use cases check
// everything again; these only read the form and say what happened in words.

/** "Let other players see my real collection" (rule 5, off by default). */
export const setRealSharingAction = formRedirect(
  z.object({ shared: checkbox() }),
  async ({ actor, capabilities }, { shared }) => {
    await capabilities.realCollection.setRealSharing(actor, shared);
    revalidateRealCollection();
    return REAL_COLLECTION_PATH;
  },
);

/** Empties the real collection, after the page's second click to confirm. */
export async function clearRealCollectionAction(): Promise<void> {
  const { actor, capabilities } = await readPage();
  const removed = await capabilities.realCollection.clearRealCollection(actor);
  revalidateRealCollection();
  redirect(realCollectionMessagePath(`Removed ${removed} rows.`));
}

/** Sets how many real copies of a printing you have, from the card page's box. */
export const setRealCopiesAction = formRedirect(
  z.object({
    printingId: z.string().default(""),
    finish: FinishSchema,
    quantity: z.coerce.number().int().min(0).max(MAX_REAL_QUANTITY).catch(-1),
  }),
  async ({ actor, capabilities }, { printingId, finish, quantity }) => {
    const result = await capabilities.realCollection.setRealCopies(actor, {
      printingId: PrintingId.of(printingId),
      finish,
      quantity,
    });
    revalidateRealCollection();
    revalidateCard(printingId);
    return cardPath(printingId, result.ok ? undefined : result.error.kind);
  },
);

/** Moves your real copies of this printing to another printing of the same card. */
export const changeRealPrintingAction = formRedirect(
  z.object({
    printingId: z.string().default(""),
    finish: FinishSchema,
    to: z.string().default(""),
  }),
  async ({ actor, capabilities }, input) => {
    const from = { printingId: PrintingId.of(input.printingId), finish: input.finish };
    const [toPrinting, toFinish] = input.to.split("/");
    const result = await capabilities.realCollection.changeRealPrinting(actor, from, {
      printingId: PrintingId.of(toPrinting ?? ""),
      finish: FinishSchema.catch("nonfoil").parse(toFinish),
    });
    revalidateRealCollection();
    if (!result.ok) return cardPath(from.printingId, result.error.kind);
    return cardPath(result.value.printingId);
  },
);

/** Deletes a real product's record, and its cards too when the box is ticked (rule 13). */
export const removeRealProductAction = formRedirect(
  z.object({ realProductId: z.coerce.number().int().positive(), removeCards: checkbox() }),
  async ({ actor, capabilities }, { realProductId, removeCards }) => {
    const result = await capabilities.realCollection.removeRealProduct(actor, {
      realProductId,
      removeCards,
    });
    revalidateRealCollection();
    const message = !result.ok
      ? "That product isn't in your real collection."
      : removeCards
        ? `Removed the product and ${result.value.removed.length + result.value.changed.length} of its cards' rows.`
        : "Removed the product. Its cards stay in your real collection.";
    return realCollectionMessagePath(message);
  },
);

/** Makes a deck (real cards on) from each precon a real product holds (rule 11). */
async function makeDecks(
  { actor, capabilities }: Pick<PageContext, "actor" | "capabilities">,
  decks: readonly ProductDeck[],
): Promise<{ made: Array<{ id: number; name: string }>; failed: string[] }> {
  const made: Array<{ id: number; name: string }> = [];
  const failed: string[] = [];
  for (const deck of decks.filter((each) => becomesADeck(each.type))) {
    const created = await capabilities.deckEdits.createDeckFromCards(actor, {
      name: deck.name,
      cards: deck.cards,
    });
    if (created.ok) made.push({ id: created.value, name: deck.name });
    else failed.push(deck.name);
  }
  return { made, failed };
}

/** What the store page shows after "I own this for real". */
export type RealProductState =
  | Readonly<{ kind: "Idle" }>
  | Readonly<{ kind: "Error"; message: string }>
  /** The product holds "one of these": the player picks, then submits again with the choices. */
  | Readonly<{ kind: "Choose"; choices: number[]; index: number; options: string[] }>
  | Readonly<{
      kind: "Added";
      cards: number;
      decks: Array<{ id: number; name: string }>;
      decksNotMade: string[];
      notAdded: string[];
    }>;

/** Records a product you own for real, adds its known cards and makes decks from its precons. */
export async function addRealProductAction(
  _previous: RealProductState,
  formData: FormData,
): Promise<RealProductState> {
  const { actor, capabilities } = await readPage();
  const form = parseForm(
    z.object({ productId: z.string().default(""), choices: z.string().default("") }),
    formData,
  );
  if (!form.success) return { kind: "Error", message: "That product isn't in the catalog." };
  const productId = SealedProductId.of(form.data.productId);
  const choices = form.data.choices
    .split(",")
    .filter((part) => part !== "")
    .map(Number)
    .filter((choice) => Number.isSafeInteger(choice) && choice >= 0);

  const result = await capabilities.realCollection.addRealProduct(actor, { productId, choices });
  if (!result.ok) {
    switch (result.error.kind) {
      case "ChoiceNeeded":
        return {
          kind: "Choose",
          choices,
          index: result.error.index,
          options: result.error.options,
        };
      case "ProductNotFound":
        return { kind: "Error", message: "That product isn't in the catalog." };
      case "ProductUnavailable":
        return {
          kind: "Error",
          message:
            "Something this product holds is missing from the catalog, so nothing was added.",
        };
    }
  }
  const { cards } = result.value;
  const decks = await makeDecks({ actor, capabilities }, cards.decks);
  revalidateRealCollection();
  revalidateStoreSetPages();
  return {
    kind: "Added",
    cards: cards.copies.reduce((total, copy) => total + copy.quantity, 0),
    decks: decks.made,
    decksNotMade: decks.failed,
    notAdded: [...cards.notAdded],
  };
}

const PreviewInput = z.object({
  text: z.string().max(MAX_IMPORT_BYTES),
  mode: z.enum(["add", "replace"]),
});

/** The preview, plus every printing each matched card could be changed to. */
export type PreviewAnswer =
  | Readonly<{ ok: true; preview: ImportPreview; printings: Record<string, PrintingChoice[]> }>
  | Readonly<{ ok: false; message: string }>;

/** Reads and matches an import without saving anything (section 7: the preview). */
export async function previewImportAction(
  input: z.input<typeof PreviewInput>,
): Promise<PreviewAnswer> {
  const { actor, capabilities, reads } = await readPage();
  const parsed = PreviewInput.safeParse(input);
  if (!parsed.success)
    return { ok: false, message: "That's too much to import at once (5 MB at most)." };
  const result = await capabilities.realCollection.previewImport(actor, parsed.data);
  if (!result.ok) {
    const message = {
      ImportEmpty: "There's nothing to import: paste a list or choose a file.",
      ImportTooLarge: `That's too much to import at once: at most ${MAX_IMPORT_LINES.toLocaleString("en-US")} lines or 5 MB.`,
      FormatNotRecognized:
        "That file isn't a format we read. Use a Moxfield or ManaBox CSV, our own export, or a pasted list.",
    }[result.error.kind];
    return { ok: false, message };
  }
  const oracleIds = result.value.lines.flatMap((line) =>
    line.kind === "Matched" ? [line.oracleId] : [],
  );
  const printings = Object.fromEntries(await reads.realCollection.printingChoices(oracleIds));
  return { ok: true, preview: result.value, printings };
}

const ApplyInput = z.object({
  lines: z
    .array(
      z.object({
        printingId: z.string().min(1).max(64),
        finish: FinishSchema,
        quantity: z.number().int().min(1).max(MAX_REAL_QUANTITY),
        board: z.enum(["commander", "main", "side"]),
      }),
    )
    .max(MAX_IMPORT_LINES),
  mode: z.enum(["add", "replace"]),
  version: z.object({ updatedAt: z.string().nullable(), rows: z.number().int().min(0) }),
  /** "Also make a deck from this list" (section 15.2): the deck's name, or null. */
  deckName: z.string().max(60).nullable(),
});

export type ApplyAnswer =
  | Readonly<{ ok: true; message: string; deck: { id: number; name: string } | null }>
  | Readonly<{ ok: false; message: string; changed: boolean }>;

/** Imports exactly the confirmed lines (rule 6), then makes the deck if asked. */
export async function applyImportAction(input: z.input<typeof ApplyInput>): Promise<ApplyAnswer> {
  const { actor, capabilities } = await readPage();
  const parsed = ApplyInput.safeParse(input);
  if (!parsed.success)
    return { ok: false, message: "Something in the import wasn't readable.", changed: false };
  const { lines, mode, version, deckName } = parsed.data;
  const copies = lines.map((line) => ({
    printingId: PrintingId.of(line.printingId),
    finish: line.finish,
    quantity: line.quantity,
  }));

  const result = await capabilities.realCollection.applyImport(actor, { copies, mode, version });
  if (!result.ok) {
    const message = {
      ImportEmpty: "No line matched a card, so there's nothing to import.",
      ImportTooLarge: "That's too much to import at once.",
      CollectionChanged:
        "Your real collection changed since this preview (another tab?). Check the new preview, then import again.",
      PrintingNotFound: "A printing in the import isn't in the catalog any more.",
      FinishNotAvailable: "A card in the import doesn't come in the finish chosen.",
      QuantityInvalid: "Each line needs between 1 and 9,999 copies.",
    }[result.error.kind];
    return { ok: false, message, changed: result.error.kind === "CollectionChanged" };
  }
  revalidateRealCollection();
  const plan = result.value;
  const summary = `Imported: ${plan.added.length} new, ${plan.changed.length} changed, ${plan.removed.length} removed.`;
  if (deckName === null || deckName.trim() === "")
    return { ok: true, message: summary, deck: null };

  // The real copies are saved; the deck comes second, so failing to make it keeps the import.
  const cards = lines.map((line) => ({
    ...line,
    printingId: PrintingId.of(line.printingId),
    quantity: Math.min(99, line.quantity),
  }));
  const created = await capabilities.deckEdits.createDeckFromCards(actor, {
    name: deckName,
    cards,
  });
  if (!created.ok) {
    const why =
      created.error.kind === "TooManyDecks"
        ? "you already have the most decks allowed"
        : "its name wasn't usable";
    return { ok: true, message: `${summary} The deck wasn't made: ${why}.`, deck: null };
  }
  return { ok: true, message: summary, deck: { id: created.value, name: deckName.trim() } };
}
