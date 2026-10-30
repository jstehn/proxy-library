"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Actor } from "@/modules/accounts";
import { PrintingId, SealedProductId } from "@/modules/catalog";
import { becomesADeck } from "@/modules/decks";
import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_LINES,
  MAX_REAL_QUANTITY,
  printingChoices,
  type ImportPreview,
  type PrintingChoice,
  type ProductDeck,
} from "@/modules/real-collection";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";

// Server actions for the real collection (design doc 16, sections 7 and 15). The use cases check
// everything again; these only read the form and say what happened in words.

const Finish = z.enum(["nonfoil", "foil", "etched"]);

function refresh() {
  revalidatePath("/collection/real");
  revalidatePath("/decks");
}

/** "Let other players see my real collection" (rule 5, off by default). */
export async function setRealSharingAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  await getContainer().realCollection.setRealSharing(actor, formData.get("shared") === "on");
  refresh();
  redirect("/collection/real");
}

/** Empties the real collection, after the page's second click to confirm. */
export async function clearRealCollectionAction(): Promise<void> {
  const actor = await requireActor();
  const removed = await getContainer().realCollection.clearRealCollection(actor);
  refresh();
  redirect(`/collection/real?message=${encodeURIComponent(`Removed ${removed} rows.`)}`);
}

/** Sets how many real copies of a printing you have, from the card page's box. */
export async function setRealCopiesAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const printingId = String(formData.get("printingId") ?? "");
  const finish = Finish.parse(formData.get("finish"));
  const quantity = z.coerce
    .number()
    .int()
    .min(0)
    .max(MAX_REAL_QUANTITY)
    .catch(-1)
    .parse(formData.get("quantity"));
  const result = await getContainer().realCollection.setRealCopies(actor, {
    printingId: PrintingId.of(printingId),
    finish,
    quantity,
  });
  refresh();
  revalidatePath(`/cards/${printingId}`);
  const error = result.ok ? "" : `?realError=${result.error.kind}`;
  redirect(`/cards/${printingId}${error}`);
}

/** Moves your real copies of this printing to another printing of the same card. */
export async function changeRealPrintingAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const from = {
    printingId: PrintingId.of(String(formData.get("printingId") ?? "")),
    finish: Finish.parse(formData.get("finish")),
  };
  const [toPrinting, toFinish] = String(formData.get("to") ?? "").split("/");
  const result = await getContainer().realCollection.changeRealPrinting(actor, from, {
    printingId: PrintingId.of(toPrinting ?? ""),
    finish: Finish.catch("nonfoil").parse(toFinish),
  });
  refresh();
  if (!result.ok) redirect(`/cards/${from.printingId}?realError=${result.error.kind}`);
  redirect(`/cards/${result.value.printingId}`);
}

/** Deletes a real product's record, and its cards too when the box is ticked (rule 13). */
export async function removeRealProductAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const realProductId = z.coerce.number().int().positive().parse(formData.get("realProductId"));
  const removeCards = formData.get("removeCards") === "on";
  const result = await getContainer().realCollection.removeRealProduct(actor, {
    realProductId,
    removeCards,
  });
  refresh();
  const message = !result.ok
    ? "That product isn't in your real collection."
    : removeCards
      ? `Removed the product and ${result.value.removed.length + result.value.changed.length} of its cards' rows.`
      : "Removed the product. Its cards stay in your real collection.";
  redirect(`/collection/real?message=${encodeURIComponent(message)}`);
}

/** Makes a deck (real cards on) from each precon a real product holds (rule 11). */
async function makeDecks(
  actor: Actor,
  decks: readonly ProductDeck[],
): Promise<{ made: Array<{ id: number; name: string }>; failed: string[] }> {
  const made: Array<{ id: number; name: string }> = [];
  const failed: string[] = [];
  for (const deck of decks.filter((each) => becomesADeck(each.type))) {
    const created = await getContainer().decks.createDeckFromCards(actor, {
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
  const actor = await requireActor();
  const productId = SealedProductId.of(String(formData.get("productId") ?? ""));
  const choices = String(formData.get("choices") ?? "")
    .split(",")
    .filter((part) => part !== "")
    .map(Number)
    .filter((choice) => Number.isSafeInteger(choice) && choice >= 0);

  const result = await getContainer().realCollection.addRealProduct(actor, { productId, choices });
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
  const decks = await makeDecks(actor, cards.decks);
  refresh();
  revalidatePath("/store/[code]", "page");
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
  const actor = await requireActor();
  const parsed = PreviewInput.safeParse(input);
  if (!parsed.success)
    return { ok: false, message: "That's too much to import at once (5 MB at most)." };
  const result = await getContainer().realCollection.previewImport(actor, parsed.data);
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
  const printings = Object.fromEntries(await printingChoices(getContainer().db, oracleIds));
  return { ok: true, preview: result.value, printings };
}

const ApplyInput = z.object({
  lines: z
    .array(
      z.object({
        printingId: z.string().min(1).max(64),
        finish: Finish,
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
  const actor = await requireActor();
  const parsed = ApplyInput.safeParse(input);
  if (!parsed.success)
    return { ok: false, message: "Something in the import wasn't readable.", changed: false };
  const { lines, mode, version, deckName } = parsed.data;
  const copies = lines.map((line) => ({
    printingId: PrintingId.of(line.printingId),
    finish: line.finish,
    quantity: line.quantity,
  }));

  const result = await getContainer().realCollection.applyImport(actor, { copies, mode, version });
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
  refresh();
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
  const created = await getContainer().decks.createDeckFromCards(actor, { name: deckName, cards });
  if (!created.ok) {
    const why =
      created.error.kind === "TooManyDecks"
        ? "you already have the most decks allowed"
        : "its name wasn't usable";
    return { ok: true, message: `${summary} The deck wasn't made: ${why}.`, deck: null };
  }
  return { ok: true, message: summary, deck: { id: created.value, name: deckName.trim() } };
}
