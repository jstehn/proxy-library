"use server";
import { z } from "zod";
import { CommentId, DeckId, FORMATS, MAX_COMMENT_LENGTH, VISIBILITIES } from "@/modules/decks";
import type { Actor } from "@/modules/accounts";
import type { Capabilities } from "@/server/capabilities";
import { checkbox } from "@/server/form-action";
import { formRedirect } from "@/server/form-action-instance";
import { DECKS_PATH, deckPath, revalidateDeck, revalidateDeckList } from "./paths";

// Server actions for the deck screens. Errors come back as ?error=… on the page they came from.
// A form that can't be read goes back to the deck list.

const FORM_UNREADABLE = { unreadable: DECKS_PATH };
const DeckIdField = z.coerce.number().int().positive();
const DeckForm = z.object({ deckId: DeckIdField });

export const createDeckAction = formRedirect(
  z.object({ format: z.enum(FORMATS).catch("casual"), name: z.string().default("") }),
  async ({ actor, capabilities }, input) => {
    const result = await capabilities.deckEdits.createDeck(actor, input);
    if (!result.ok) {
      const message =
        result.error.kind === "NameInvalid"
          ? `Give the deck a name of up to ${result.error.maximum} characters.`
          : `You already have ${result.error.maximum} decks.`;
      return `${DECKS_PATH}?error=${encodeURIComponent(message)}`;
    }
    revalidateDeckList();
    return deckPath(result.value);
  },
);

export const updateDeckAction = formRedirect(
  z.object({ deckId: DeckIdField, format: z.enum(FORMATS), name: z.string().default("") }),
  async ({ actor, capabilities }, { deckId, format, name }) => {
    const result = await capabilities.deckEdits.updateDeck(actor, {
      deckId: DeckId.of(deckId),
      name,
      format,
    });
    if (!result.ok) {
      return result.error.kind === "DeckNotFound"
        ? DECKS_PATH
        : deckPath(deckId, "Give the deck a name of up to 60 characters.");
    }
    revalidateDeck(deckId);
    return deckPath(deckId);
  },
  FORM_UNREADABLE,
);

/** "Use my real cards" (design doc 16): whether real copies count as owned in this deck. */
export const setUsesRealCardsAction = formRedirect(
  z.object({ deckId: DeckIdField, usesRealCards: checkbox() }),
  async ({ actor, capabilities }, { deckId, usesRealCards }) => {
    const result = await capabilities.deckEdits.updateDeck(actor, {
      deckId: DeckId.of(deckId),
      usesRealCards,
    });
    if (!result.ok) return DECKS_PATH;
    revalidateDeckList();
    revalidateDeck(deckId);
    return deckPath(deckId);
  },
  FORM_UNREADABLE,
);

export const deleteDeckAction = formRedirect(
  DeckForm,
  async ({ actor, capabilities }, { deckId }) => {
    await capabilities.deckEdits.deleteDeck(actor, DeckId.of(deckId));
    revalidateDeckList();
    return DECKS_PATH;
  },
  FORM_UNREADABLE,
);

export const importListAction = formRedirect(
  z.object({ deckId: DeckIdField, list: z.string().default("") }),
  async ({ actor, capabilities }, { deckId, list }) => {
    const result = await capabilities.deckEdits.importList(actor, {
      deckId: DeckId.of(deckId),
      text: list,
    });
    if (!result.ok) return DECKS_PATH;
    const { added, unreadable, notFound } = result.value;
    const parts = [`Added ${added} cards.`];
    if (notFound.length > 0) parts.push(`Not in the catalog: ${notFound.join(", ")}.`);
    if (unreadable.length > 0) parts.push(`Couldn't read: ${unreadable.join(" | ")}.`);
    revalidateDeck(deckId);
    return `${deckPath(deckId)}?imported=${encodeURIComponent(parts.join(" "))}`;
  },
  FORM_UNREADABLE,
);

/** Shares a deck with the playgroup, or makes it private again (design doc 21). */
export const setVisibilityAction = formRedirect(
  z.object({ deckId: DeckIdField, visibility: z.enum(VISIBILITIES) }),
  async ({ actor, capabilities }, { deckId, visibility }) => {
    const result = await capabilities.deckSharing.setVisibility(actor, {
      deckId: DeckId.of(deckId),
      visibility,
    });
    if (!result.ok) return DECKS_PATH;
    revalidateDeck(deckId);
    revalidateDeckList();
    return deckPath(deckId);
  },
  FORM_UNREADABLE,
);

/** The three public-link forms differ only in what they ask the capability to do. */
function publicLinkAction(
  change: (
    deckSharing: Capabilities["deckSharing"],
    actor: Actor,
    deckId: DeckId,
  ) => Promise<{ ok: boolean }>,
) {
  return formRedirect(
    DeckForm,
    async ({ actor, capabilities }, { deckId }) => {
      const result = await change(capabilities.deckSharing, actor, DeckId.of(deckId));
      if (!result.ok) return DECKS_PATH;
      revalidateDeck(deckId);
      return deckPath(deckId);
    },
    FORM_UNREADABLE,
  );
}

/** Creates (or returns) the deck's public read-only link (design doc 47). */
export const enablePublicLinkAction = publicLinkAction((deckSharing, actor, deckId) =>
  deckSharing.enablePublicLink(actor, { deckId }),
);

/** Replaces the deck's public link with a fresh token (design doc 47). */
export const rotatePublicLinkAction = publicLinkAction((deckSharing, actor, deckId) =>
  deckSharing.rotatePublicLink(actor, { deckId }),
);

/** Turns off the deck's public link so `/d/[token]` returns 404 (design doc 47). */
export const revokePublicLinkAction = publicLinkAction((deckSharing, actor, deckId) =>
  deckSharing.revokePublicLink(actor, { deckId }),
);

/** Copies a shared deck into the signed-in player's own decks (design doc 48). */
export const copyDeckAction = formRedirect(
  DeckForm,
  async ({ actor, capabilities }, { deckId }) => {
    const result = await capabilities.deckEdits.copyDeck(actor, {
      kind: "deck",
      deckId: DeckId.of(deckId),
    });
    if (!result.ok) {
      if (result.error.kind === "DeckNotFound") return DECKS_PATH;
      return deckPath(deckId, `You already have ${result.error.maximum} decks.`);
    }
    revalidateDeckList();
    return deckPath(result.value);
  },
  FORM_UNREADABLE,
);

/** Copies a deck opened via its `/d/[token]` public link into the signed-in player's decks. */
export const copyPublicDeckAction = formRedirect(
  z.object({ token: z.string().default("") }),
  async ({ actor, capabilities }, { token }) => {
    const result = await capabilities.deckEdits.copyDeck(actor, { kind: "publicToken", token });
    if (!result.ok) {
      if (result.error.kind === "DeckNotFound") return DECKS_PATH;
      const message = `You already have ${result.error.maximum} decks.`;
      return `/d/${encodeURIComponent(token)}?error=${encodeURIComponent(message)}`;
    }
    revalidateDeckList();
    return deckPath(result.value);
  },
);

/** Comments on a deck you can see. */
export const postCommentAction = formRedirect(
  z.object({ deckId: DeckIdField, body: z.string().default("") }),
  async ({ actor, capabilities }, { deckId, body }) => {
    const result = await capabilities.deckSharing.postComment(actor, {
      deckId: DeckId.of(deckId),
      body,
    });
    if (!result.ok) {
      if (result.error.kind === "DeckNotFound") return DECKS_PATH;
      return `${deckPath(deckId, `Write a comment of 1 to ${MAX_COMMENT_LENGTH} characters.`)}#comments`;
    }
    revalidateDeck(deckId);
    return `${deckPath(deckId)}#comment-${result.value}`;
  },
  FORM_UNREADABLE,
);

/** Deletes a comment (its author, the deck's owner or an admin). */
export const deleteCommentAction = formRedirect(
  z.object({ deckId: DeckIdField, commentId: z.coerce.number().int().positive() }),
  async ({ actor, capabilities }, { deckId, commentId }) => {
    const result = await capabilities.deckSharing.deleteComment(actor, CommentId.of(commentId));
    if (!result.ok) return `${deckPath(deckId, "That comment can't be deleted.")}#comments`;
    revalidateDeck(deckId);
    return `${deckPath(deckId)}#comments`;
  },
  FORM_UNREADABLE,
);
