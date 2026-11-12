"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  CommentId,
  DeckId,
  deckListPreview,
  FORMATS,
  MAX_COMMENT_LENGTH,
  VISIBILITIES,
} from "@/modules/decks";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { bracketWarningText, estimateLabel, problemText, TAG_LABELS } from "./labels";

// Server actions for the deck screens. Errors come back as ?error=… on the page they came from.

function deckPath(deckId: number, error?: string): string {
  return error === undefined
    ? `/decks/${deckId}`
    : `/decks/${deckId}?error=${encodeURIComponent(error)}`;
}

export async function createDeckAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const format = z.enum(FORMATS).catch("casual").parse(formData.get("format"));
  const result = await getContainer().decks.createDeck(actor, {
    name: String(formData.get("name") ?? ""),
    format,
  });
  if (!result.ok) {
    const message =
      result.error.kind === "NameInvalid"
        ? `Give the deck a name of up to ${result.error.maximum} characters.`
        : `You already have ${result.error.maximum} decks.`;
    redirect(`/decks?error=${encodeURIComponent(message)}`);
  }
  revalidatePath("/decks");
  redirect(deckPath(result.value));
}

export async function updateDeckAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const deckId = Number(formData.get("deckId"));
  const format = z.enum(FORMATS).parse(formData.get("format"));
  const result = await getContainer().decks.updateDeck(actor, {
    deckId: DeckId.of(deckId),
    name: String(formData.get("name") ?? ""),
    format,
  });
  if (!result.ok)
    redirect(
      result.error.kind === "DeckNotFound"
        ? "/decks"
        : deckPath(deckId, "Give the deck a name of up to 60 characters."),
    );
  revalidatePath(deckPath(deckId));
  redirect(deckPath(deckId));
}

/** "Use my real cards" (design doc 16): whether real copies count as owned in this deck. */
export async function setUsesRealCardsAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const deckId = Number(formData.get("deckId"));
  const result = await getContainer().decks.updateDeck(actor, {
    deckId: DeckId.of(deckId),
    usesRealCards: formData.get("usesRealCards") === "on",
  });
  if (!result.ok) redirect("/decks");
  revalidatePath("/decks");
  revalidatePath(deckPath(deckId));
  redirect(deckPath(deckId));
}

export async function deleteDeckAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  await getContainer().decks.deleteDeck(actor, DeckId.of(Number(formData.get("deckId"))));
  revalidatePath("/decks");
  redirect("/decks");
}

export async function importListAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const deckId = Number(formData.get("deckId"));
  const result = await getContainer().decks.importList(actor, {
    deckId: DeckId.of(deckId),
    text: String(formData.get("list") ?? ""),
  });
  if (!result.ok) redirect("/decks");
  const { added, unreadable, notFound } = result.value;
  const parts = [`Added ${added} cards.`];
  if (notFound.length > 0) parts.push(`Not in the catalog: ${notFound.join(", ")}.`);
  if (unreadable.length > 0) parts.push(`Couldn't read: ${unreadable.join(" | ")}.`);
  revalidatePath(deckPath(deckId));
  redirect(`${deckPath(deckId)}?imported=${encodeURIComponent(parts.join(" "))}`);
}

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
  const actor = await requireActor();
  const deckId = Number(formData.get("deckId"));
  if (!Number.isSafeInteger(deckId) || deckId <= 0) redirect("/decks");
  const result = await getContainer().decks.replaceList(actor, {
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
  const actor = await requireActor();
  const deckId = Number(formData.get("deckId"));
  if (!Number.isSafeInteger(deckId) || deckId <= 0) redirect("/decks");
  const listText = String(formData.get("list") ?? "");
  const result = await deckListPreview(
    getContainer().db,
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

/** Shares a deck with the playgroup, or makes it private again (design doc 21). */
export async function setVisibilityAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const deckId = Number(formData.get("deckId"));
  const visibility = z.enum(VISIBILITIES).parse(formData.get("visibility"));
  const result = await getContainer().deckSharing.setVisibility(actor, {
    deckId: DeckId.of(deckId),
    visibility,
  });
  if (!result.ok) redirect("/decks");
  revalidatePath(deckPath(deckId));
  revalidatePath("/decks");
  redirect(deckPath(deckId));
}

async function runPublicLinkAction(
  formData: FormData,
  run: (deckId: DeckId) => Promise<{ ok: boolean }>,
): Promise<void> {
  const deckId = Number(formData.get("deckId"));
  const result = await run(DeckId.of(deckId));
  if (!result.ok) redirect("/decks");
  revalidatePath(deckPath(deckId));
  redirect(deckPath(deckId));
}

/** Creates (or returns) the deck's public read-only link (design doc 47). */
export async function enablePublicLinkAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  await runPublicLinkAction(formData, (deckId) =>
    getContainer().deckSharing.enablePublicLink(actor, { deckId }),
  );
}

/** Replaces the deck's public link with a fresh token (design doc 47). */
export async function rotatePublicLinkAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  await runPublicLinkAction(formData, (deckId) =>
    getContainer().deckSharing.rotatePublicLink(actor, { deckId }),
  );
}

/** Turns off the deck's public link so `/d/[token]` returns 404 (design doc 47). */
export async function revokePublicLinkAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  await runPublicLinkAction(formData, (deckId) =>
    getContainer().deckSharing.revokePublicLink(actor, { deckId }),
  );
}

/** Copies a shared deck into the signed-in player's own decks (design doc 48). */
export async function copyDeckAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const deckId = Number(formData.get("deckId"));
  const result = await getContainer().decks.copyDeck(actor, {
    kind: "deck",
    deckId: DeckId.of(deckId),
  });
  if (!result.ok) {
    if (result.error.kind === "DeckNotFound") redirect("/decks");
    redirect(deckPath(deckId, `You already have ${result.error.maximum} decks.`));
  }
  revalidatePath("/decks");
  redirect(deckPath(result.value));
}

/** Copies a deck opened via its `/d/[token]` public link into the signed-in player's decks. */
export async function copyPublicDeckAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const token = String(formData.get("token") ?? "");
  const result = await getContainer().decks.copyDeck(actor, { kind: "publicToken", token });
  if (!result.ok) {
    if (result.error.kind === "DeckNotFound") redirect("/decks");
    redirect(
      `/d/${encodeURIComponent(token)}?error=${encodeURIComponent(`You already have ${result.error.maximum} decks.`)}`,
    );
  }
  revalidatePath("/decks");
  redirect(deckPath(result.value));
}

/** Comments on a deck you can see. */
export async function postCommentAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const deckId = Number(formData.get("deckId"));
  const result = await getContainer().deckSharing.postComment(actor, {
    deckId: DeckId.of(deckId),
    body: String(formData.get("body") ?? ""),
  });
  if (!result.ok) {
    if (result.error.kind === "DeckNotFound") redirect("/decks");
    redirect(
      `${deckPath(deckId, `Write a comment of 1 to ${MAX_COMMENT_LENGTH} characters.`)}#comments`,
    );
  }
  revalidatePath(deckPath(deckId));
  redirect(`${deckPath(deckId)}#comment-${result.value}`);
}

/** Deletes a comment (its author, the deck's owner or an admin). */
export async function deleteCommentAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const deckId = Number(formData.get("deckId"));
  const result = await getContainer().deckSharing.deleteComment(
    actor,
    CommentId.of(Number(formData.get("commentId"))),
  );
  if (!result.ok) {
    redirect(`${deckPath(deckId, "That comment can't be deleted.")}#comments`);
  }
  revalidatePath(deckPath(deckId));
  redirect(`${deckPath(deckId)}#comments`);
}
