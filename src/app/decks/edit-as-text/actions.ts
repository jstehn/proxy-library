"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { DeckId } from "@/modules/decks";
import { parseForm } from "@/server/form-action";
import { readPage } from "@/server/page-instance";
import { DECKS_PATH, deckPath, revalidateDeck, revalidateDeckList } from "../paths";
import { presentListPreview, type ListPreviewSummary } from "./list-preview";

// The Edit as text box's server actions (design doc 23, design doc 40). Both keep their own state
// (the problems, the preview), so they read the form with `parseForm`. A form that can't be read
// goes back to the deck list.

const EditForm = z.object({
  deckId: z.coerce.number().int().positive(),
  list: z.string().default(""),
  fingerprint: z.string().default(""),
});

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
  const form = parseForm(EditForm, formData);
  if (!form.success) redirect(DECKS_PATH);
  const { deckId, list, fingerprint } = form.data;
  const result = await capabilities.deckEdits.replaceList(actor, {
    deckId: DeckId.of(deckId),
    text: list,
    fingerprint,
  });
  if (!result.ok) {
    const { error } = result;
    switch (error.kind) {
      case "DeckNotFound":
        redirect(DECKS_PATH);
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
  revalidateDeckList();
  revalidateDeck(deckId);
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
  const form = parseForm(EditForm, formData);
  if (!form.success) redirect(DECKS_PATH);
  const { deckId, list: listText, fingerprint } = form.data;
  const result = await reads.decks.listPreview(actor, deckId, listText, fingerprint);
  if (!result.ok) {
    const { error } = result;
    switch (error.kind) {
      case "DeckNotFound":
        redirect(DECKS_PATH);
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
