"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DeckId } from "@/modules/decks";
import { readPage } from "@/server/page-instance";
import { bracketWarningText, estimateLabel, problemText, TAG_LABELS } from "../labels";
import { deckPath } from "../paths";

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

/** Summary shown by the "Preview changes" button inside Edit as text (design doc 40, section 6). */
export type ListPreviewSummary = Readonly<{
  beforeCards: number;
  afterCards: number;
  targetSize: number;
  exactSize: boolean;
  beforeAverageManaValue: number;
  afterAverageManaValue: number;
  roles: ReadonlyArray<{
    tag: string;
    label: string;
    before: number;
    after: number;
    target: number | null;
  }>;
  problemsAdded: string[];
  problemsResolved: string[];
  problemsRemainingCount: number;
  bracketBefore: string | null;
  bracketAfter: string | null;
  bracketWarningAfter: string | null;
  changes: ReadonlyArray<{
    name: string;
    board: string;
    before: number;
    after: number;
  }>;
}>;

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
  const { actor, capabilities } = await readPage();
  const deckId = Number(formData.get("deckId"));
  if (!Number.isSafeInteger(deckId) || deckId <= 0) redirect("/decks");
  const listText = String(formData.get("list") ?? "");
  const result = await capabilities.deckReads.listPreview(
    actor.userId,
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
  const p = result.value;
  return {
    error: null,
    problems: [],
    previewedList: listText,
    preview: {
      beforeCards: p.before.stats.cardCount,
      afterCards: p.after.stats.cardCount,
      targetSize: p.targetSize.cards,
      exactSize: p.targetSize.exact,
      beforeAverageManaValue: Math.round(p.before.stats.averageManaValue * 100) / 100,
      afterAverageManaValue: Math.round(p.after.stats.averageManaValue * 100) / 100,
      roles: p.roles
        .filter((role) => role.before > 0 || role.after > 0 || role.target !== null)
        .map((role) => ({
          tag: role.tag,
          label: TAG_LABELS[role.tag],
          before: role.before,
          after: role.after,
          target: role.target,
        })),
      problemsAdded: p.problems.added.map(problemText),
      problemsResolved: p.problems.resolved.map(problemText),
      problemsRemainingCount: p.problems.remaining.length,
      bracketBefore: p.bracket.before === null ? null : estimateLabel(p.bracket.before),
      bracketAfter: p.bracket.after === null ? null : estimateLabel(p.bracket.after),
      bracketWarningAfter:
        p.bracket.warningAfter === null ? null : bracketWarningText(p.bracket.warningAfter),
      changes: p.changes.map((change) => ({
        name: change.name,
        board: change.board,
        before: change.beforeQuantity,
        after: change.afterQuantity,
      })),
    },
  };
}
