import { err, ok, type Brand, type Result, type UserId } from "@/shared/kernel";
import type { DeckId } from "./deck";
import type { CommentInvalid } from "./errors";

// Sharing decks with the playgroup, and comments on them (design doc 21, section 3).

export const VISIBILITIES = ["private", "shared"] as const;
/** Who can see a deck: only its owner, or every signed-in player. */
export type Visibility = (typeof VISIBILITIES)[number];

export type CommentId = Brand<number, "CommentId">;
export const CommentId = {
  of(raw: number): CommentId {
    if (!Number.isSafeInteger(raw) || raw <= 0) throw new RangeError(`not a comment id: ${raw}`);
    return raw as CommentId;
  },
};

/** What sharing needs to know about a deck. */
export type DeckForSharing = Readonly<{
  id: DeckId;
  ownerId: UserId;
  name: string;
  format: string;
  visibility: Visibility;
  /** When it was first shared: the feed announces a deck only once (invariant 2). */
  firstSharedAt: Date | null;
}>;

export type DeckComment = Readonly<{
  id: CommentId;
  deckId: DeckId;
  authorId: UserId;
  deletedAt: Date | null;
}>;

export const MAX_COMMENT_LENGTH = 1000;

/** A comment's text: trimmed, 1 to 1 000 characters. */
export function checkCommentBody(raw: string): Result<string, CommentInvalid> {
  const body = raw.trim();
  if (body.length === 0 || body.length > MAX_COMMENT_LENGTH) {
    return err({ kind: "CommentInvalid", maximum: MAX_COMMENT_LENGTH });
  }
  return ok(body);
}

/** Its owner sees a deck; everyone sees a shared one (invariant 1). */
export function canViewDeck(
  viewer: UserId,
  deck: Pick<DeckForSharing, "ownerId" | "visibility">,
): boolean {
  return deck.ownerId === viewer || deck.visibility === "shared";
}

/** A comment's author, the deck's owner and admins may delete it (invariant 4). */
export function canDeleteComment(
  actor: Readonly<{ userId: UserId; isAdmin: boolean }>,
  comment: Pick<DeckComment, "authorId">,
  deck: Pick<DeckForSharing, "ownerId">,
): boolean {
  return actor.isAdmin || actor.userId === comment.authorId || actor.userId === deck.ownerId;
}

/** How many copies of a card one deck uses (every board), for cards to get. */
export type DeckNeed = Readonly<{ deckId: number; oracleId: string; quantity: number }>;

export type CardToGet = Readonly<{
  oracleId: string;
  /** Copies to get so that every deck has enough. */
  missing: number;
  /** The decks that need more than you own. */
  deckIds: readonly number[];
}>;

/**
 * Cards to get across all your decks (invariant 6). One copy serves every deck (design doc 09),
 * so what you need is what the hungriest deck needs: the maximum, never the sum. Basic lands are
 * the caller's to leave out.
 */
export function cardsToGet(
  needs: readonly DeckNeed[],
  owned: ReadonlyMap<string, number>,
): CardToGet[] {
  const perDeck = new Map<string, Map<number, number>>();
  for (const need of needs) {
    const decks = perDeck.get(need.oracleId) ?? new Map<number, number>();
    decks.set(need.deckId, (decks.get(need.deckId) ?? 0) + need.quantity);
    perDeck.set(need.oracleId, decks);
  }
  const result: CardToGet[] = [];
  for (const [oracleId, decks] of perDeck) {
    const have = owned.get(oracleId) ?? 0;
    const most = Math.max(...decks.values());
    if (most <= have) continue;
    const short = [...decks].filter(([, quantity]) => quantity > have).map(([deckId]) => deckId);
    result.push({ oracleId, missing: most - have, deckIds: short.sort((a, b) => a - b) });
  }
  return result;
}
