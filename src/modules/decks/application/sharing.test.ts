import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/modules/accounts";
import { inMemoryEventRecorder } from "@/modules/activity/testing/fakes";
import { UserId } from "@/shared/kernel";
import { fixedClock, inMemoryUnitOfWork } from "@/shared/kernel/testing";
import { DeckId } from "../domain/deck";
import { CommentId } from "../domain/sharing";
import { inMemoryDeckSharing } from "../testing/fakes";
import { makeDeckSharing } from "./sharing";

function actor(id: string, isAdmin = false): Actor {
  return {
    userId: UserId.of(id),
    username: id as Actor["username"],
    displayName: id as Actor["displayName"],
    isAdmin,
    canSelfFund: false,
    mustChangePassword: false,
  };
}

const jack = actor("jack");
const sam = actor("sam");
const ada = actor("ada", true);
const deckId = DeckId.of(1);
const NOW = "2026-10-03T08:00:00Z";

let repository: ReturnType<typeof inMemoryDeckSharing>;
let events: ReturnType<typeof inMemoryEventRecorder>;
let sharing: ReturnType<typeof makeDeckSharing>;

beforeEach(() => {
  repository = inMemoryDeckSharing([
    {
      id: deckId,
      ownerId: jack.userId,
      name: "Beza",
      format: "commander",
      visibility: "private",
      firstSharedAt: null,
      publicToken: null,
    },
  ]);
  events = inMemoryEventRecorder();
  let tokenCounter = 0;
  sharing = makeDeckSharing({
    unitOfWork: inMemoryUnitOfWork({ deckSharing: repository, events }),
    clock: fixedClock(NOW),
    tokens: { newPublicToken: () => `public-token-${++tokenCounter}` },
  });
});

describe("sharing a deck (design doc 21)", () => {
  it("is for the owner only; anyone else is told there's no such deck", async () => {
    expect(await sharing.setVisibility(sam, { deckId, visibility: "shared" })).toEqual({
      ok: false,
      error: { kind: "DeckNotFound" },
    });
    expect(repository.deck(deckId)?.visibility).toBe("private");
  });

  it("is announced once, the first time (invariant 2)", async () => {
    await sharing.setVisibility(jack, { deckId, visibility: "shared" });
    await sharing.setVisibility(jack, { deckId, visibility: "private" });
    await sharing.setVisibility(jack, { deckId, visibility: "shared" });
    expect(repository.deck(deckId)).toMatchObject({
      visibility: "shared",
      firstSharedAt: new Date(NOW),
    });
    expect(events.recorded.map(({ event }) => event)).toEqual([
      {
        kind: "deckShared",
        actorId: jack.userId,
        deckId: 1,
        deckName: "Beza",
        format: "commander",
      },
    ]);
  });
});

describe("comments (design doc 21)", () => {
  it("need a deck the author can see (invariants 1 and 3)", async () => {
    expect(await sharing.postComment(sam, { deckId, body: "Nice!" })).toEqual({
      ok: false,
      error: { kind: "DeckNotFound" },
    });
    // The owner can always comment on their own deck, and nobody is told about it (invariant 5).
    expect((await sharing.postComment(jack, { deckId, body: "Note to self" })).ok).toBe(true);
    expect(events.recorded).toEqual([]);
  });

  it("on a shared deck, tell its owner (invariant 5)", async () => {
    await sharing.setVisibility(jack, { deckId, visibility: "shared" });
    const posted = await sharing.postComment(sam, { deckId, body: "  Needs more ramp  " });
    expect(posted).toEqual({ ok: true, value: CommentId.of(1) });
    expect(repository.comments[0]).toMatchObject({ body: "Needs more ramp", authorId: sam.userId });
    expect(events.recorded.at(-1)?.event).toEqual({
      kind: "deckComment",
      actorId: sam.userId,
      otherId: jack.userId,
      deckId: 1,
      deckName: "Beza",
    });
  });

  it("are checked for length before anything else", async () => {
    expect(await sharing.postComment(sam, { deckId, body: "   " })).toEqual({
      ok: false,
      error: { kind: "CommentInvalid", maximum: 1000 },
    });
  });

  it("can be deleted by the author, the deck's owner or an admin, once (invariant 4)", async () => {
    await sharing.setVisibility(jack, { deckId, visibility: "shared" });
    for (const author of [sam, sam, sam]) await sharing.postComment(author, { deckId, body: "Hi" });
    const mallory = actor("mallory");

    expect(await sharing.deleteComment(mallory, CommentId.of(1))).toEqual({
      ok: false,
      error: { kind: "NotAllowed" },
    });
    expect((await sharing.deleteComment(sam, CommentId.of(1))).ok).toBe(true);
    expect((await sharing.deleteComment(jack, CommentId.of(2))).ok).toBe(true);
    expect((await sharing.deleteComment(ada, CommentId.of(3))).ok).toBe(true);
    expect(repository.comments.map((comment) => comment.deletedBy)).toEqual([
      sam.userId,
      jack.userId,
      ada.userId,
    ]);
    expect(repository.comments.every((comment) => comment.body === "")).toBe(true);

    // Deleting again changes nothing (the first deleter stays recorded).
    expect((await sharing.deleteComment(jack, CommentId.of(1))).ok).toBe(true);
    expect(repository.comments[0].deletedBy).toBe(sam.userId);
    expect(await sharing.deleteComment(jack, CommentId.of(99))).toEqual({
      ok: false,
      error: { kind: "CommentNotFound" },
    });
  });
});

describe("public deck links (design doc 47)", () => {
  it("are owner-only; non-owners get DeckNotFound", async () => {
    expect(await sharing.enablePublicLink(sam, { deckId })).toEqual({
      ok: false,
      error: { kind: "DeckNotFound" },
    });
    expect(await sharing.rotatePublicLink(sam, { deckId })).toEqual({
      ok: false,
      error: { kind: "DeckNotFound" },
    });
    expect(await sharing.revokePublicLink(sam, { deckId })).toEqual({
      ok: false,
      error: { kind: "DeckNotFound" },
    });
    expect(repository.deck(deckId)?.publicToken).toBeNull();
  });

  it("enables idempotently without changing visibility or emitting deckShared", async () => {
    const first = await sharing.enablePublicLink(jack, { deckId });
    const second = await sharing.enablePublicLink(jack, { deckId });
    expect(first).toEqual({ ok: true, value: "public-token-1" });
    expect(second).toEqual({ ok: true, value: "public-token-1" });
    expect(repository.deck(deckId)).toMatchObject({
      visibility: "private",
      firstSharedAt: null,
      publicToken: "public-token-1",
    });
    expect(events.recorded).toEqual([]);
  });

  it("rotates to a new token and revokes back to null", async () => {
    await sharing.enablePublicLink(jack, { deckId });
    const rotated = await sharing.rotatePublicLink(jack, { deckId });
    expect(rotated).toEqual({ ok: true, value: "public-token-2" });
    expect(repository.deck(deckId)?.publicToken).toBe("public-token-2");

    expect(await sharing.revokePublicLink(jack, { deckId })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(repository.deck(deckId)?.publicToken).toBeNull();
  });
});
