"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DeckId } from "@/modules/decks";
import { readPage } from "@/server/page-instance";
import { deckPath } from "../paths";
import { presentListPreview, type ListPreviewSummary } from "./list-preview";

// The Edit as text box's server actions (design doc 23, design doc 40).

/** What the Edit as text box shows after a save that didn't go through (design doc 23). */
export type EditAsTextState = Readonly<{ error: string | null; problems: string[] }>;

/**
 * Replaces a deck's list with the Edit as text box (design doc 23). Used with useActionState: on
 * a problem it returns what to show, and the box keeps its text; on success it goes back to the
 * deck page.
 */
export async function replaceListAction(
  _previous: EditAsTextState,
  formData: FormData,
): Promise<EditAsTextState> {
  const { actor, capabilities } = await readPage();
  const deckId = Number(formData.get("deckId"));
  if (!Number.isSafeInteger(deckId) || deckId <= 0) redirect("/decks");
  const result = await capabilities.deckEdits.replaceList(actor, {
    deckId: DeckId.of(deckId),
    text: String(formData.get("list") ?? ""),
    fingerprint: String(formData.get("fingerprint") ?? ""),
  });
  if (!result.ok) {
    const { error } = result;
    switch (error.kind) {
      case "DeckNotFound":
        redirect("/decks");
      case "DeckChanged":
        return {
          error:
            "This deck changed after you opened the box (in another tab?). Copy your text, reload, and paste it back to save it over the latest list.",
          problems: [],
        };
      case "ListTooLong":
        return { error: `A list can have at most ${error.maximumLines} lines.`, problems: [] };
      case "ListProblems":
        return {
          error: "Nothing was saved. Fix or remove these lines, then save again:",
          problems: [
            ...error.notFound.map((name) => `Not in the catalog: ${name}`),
            ...error.unreadable.map((line) => `Couldn't read: ${line}`),
          ],
        };
    }
  }
  revalidatePath("/decks");
  revalidatePath(deckPath(deckId));
  redirect(
    `${deckPath(deckId)}?imported=${encodeURIComponent(`Saved: ${result.value.cards} cards.`)}`,
  );
}

export type EditAsTextPreviewState = Readonly<{
  error: string | null;
  problems: string[];
  preview: ListPreviewSummary | null;
  previewedList: string | null;
}>;

/** Previews what saving the Edit as text box would change without modifying the deck. */
export async function previewListAction(
  _previous: EditAsTextPreviewState,
  formData: FormData,
): Promise<EditAsTextPreviewState> {
  const { actor, reads } = await readPage();
  const deckId = Number(formData.get("deckId"));
  if (!Number.isSafeInteger(deckId) || deckId <= 0) redirect("/decks");
  const listText = String(formData.get("list") ?? "");
  const result = await reads.decks.listPreview(
    actor,
    deckId,
    listText,
    String(formData.get("fingerprint") ?? ""),
  );
  if (!result.ok) {
    const { error } = result;
    switch (error.kind) {
      case "DeckNotFound":
        redirect("/decks");
      case "DeckChanged":
        return {
          error:
            "This deck changed after you opened the box. Reload to preview against the latest list.",
          problems: [],
          preview: null,
          previewedList: null,
        };
      case "ListTooLong":
        return {
          error: `A list can have at most ${error.maximumLines} lines.`,
          problems: [],
          preview: null,
          previewedList: null,
        };
      case "ListProblems":
        return {
          error: "Fix or remove these lines before previewing:",
          problems: [
            ...error.notFound.map((name) => `Not in the catalog: ${name}`),
            ...error.unreadable.map((line) => `Couldn't read: ${line}`),
          ],
          preview: null,
          previewedList: null,
        };
    }
  }
  return {
    error: null,
    problems: [],
    previewedList: listText,
    preview: presentListPreview(result.value),
  };
}
