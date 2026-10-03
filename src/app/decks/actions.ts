"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { CommentId, DeckId, FORMATS, MAX_COMMENT_LENGTH, VISIBILITIES } from "@/modules/decks";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";

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
