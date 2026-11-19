"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { CommentId, DeckId, FORMATS, MAX_COMMENT_LENGTH, VISIBILITIES } from "@/modules/decks";
import { readPage } from "@/server/page-instance";
import { deckPath } from "./paths";

// Server actions for the deck screens. Errors come back as ?error=… on the page they came from.

export async function createDeckAction(formData: FormData): Promise<void> {
  const { actor, capabilities } = await readPage();
  const format = z.enum(FORMATS).catch("casual").parse(formData.get("format"));
  const result = await capabilities.deckEdits.createDeck(actor, {
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
  const { actor, capabilities } = await readPage();
  const deckId = Number(formData.get("deckId"));
  const format = z.enum(FORMATS).parse(formData.get("format"));
  const result = await capabilities.deckEdits.updateDeck(actor, {
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
  const { actor, capabilities } = await readPage();
  const deckId = Number(formData.get("deckId"));
  const result = await capabilities.deckEdits.updateDeck(actor, {
    deckId: DeckId.of(deckId),
    usesRealCards: formData.get("usesRealCards") === "on",
  });
  if (!result.ok) redirect("/decks");
  revalidatePath("/decks");
  revalidatePath(deckPath(deckId));
  redirect(deckPath(deckId));
}

export async function deleteDeckAction(formData: FormData): Promise<void> {
  const { actor, capabilities } = await readPage();
  await capabilities.deckEdits.deleteDeck(actor, DeckId.of(Number(formData.get("deckId"))));
  revalidatePath("/decks");
  redirect("/decks");
}

export async function importListAction(formData: FormData): Promise<void> {
  const { actor, capabilities } = await readPage();
  const deckId = Number(formData.get("deckId"));
  const result = await capabilities.deckEdits.importList(actor, {
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
  const { actor, capabilities } = await readPage();
  const deckId = Number(formData.get("deckId"));
  const visibility = z.enum(VISIBILITIES).parse(formData.get("visibility"));
  const result = await capabilities.deckSharing.setVisibility(actor, {
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
  const { actor, capabilities } = await readPage();
  await runPublicLinkAction(formData, (deckId) =>
    capabilities.deckSharing.enablePublicLink(actor, { deckId }),
  );
}

/** Replaces the deck's public link with a fresh token (design doc 47). */
export async function rotatePublicLinkAction(formData: FormData): Promise<void> {
  const { actor, capabilities } = await readPage();
  await runPublicLinkAction(formData, (deckId) =>
    capabilities.deckSharing.rotatePublicLink(actor, { deckId }),
  );
}

/** Turns off the deck's public link so `/d/[token]` returns 404 (design doc 47). */
export async function revokePublicLinkAction(formData: FormData): Promise<void> {
  const { actor, capabilities } = await readPage();
  await runPublicLinkAction(formData, (deckId) =>
    capabilities.deckSharing.revokePublicLink(actor, { deckId }),
  );
}

/** Copies a shared deck into the signed-in player's own decks (design doc 48). */
export async function copyDeckAction(formData: FormData): Promise<void> {
  const { actor, capabilities } = await readPage();
  const deckId = Number(formData.get("deckId"));
  const result = await capabilities.deckEdits.copyDeck(actor, {
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
  const { actor, capabilities } = await readPage();
  const token = String(formData.get("token") ?? "");
  const result = await capabilities.deckEdits.copyDeck(actor, { kind: "publicToken", token });
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
  const { actor, capabilities } = await readPage();
  const deckId = Number(formData.get("deckId"));
  const result = await capabilities.deckSharing.postComment(actor, {
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
  const { actor, capabilities } = await readPage();
  const deckId = Number(formData.get("deckId"));
  const result = await capabilities.deckSharing.deleteComment(
    actor,
    CommentId.of(Number(formData.get("commentId"))),
  );
  if (!result.ok) {
    redirect(`${deckPath(deckId, "That comment can't be deleted.")}#comments`);
  }
  revalidatePath(deckPath(deckId));
  redirect(`${deckPath(deckId)}#comments`);
}
