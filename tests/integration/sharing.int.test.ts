// Sharing decks, comments and cards to get (design doc 21), against real Postgres.
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { activityFeed } from "@/modules/activity";
import {
  cardsToGetFor,
  CommentId,
  deckComments,
  deckForViewer,
  decksFor,
  makeDeckSharing,
  makeDecks,
  publicDeckByToken,
  sharedDecks,
  type DeckId,
} from "@/modules/decks";
import { makeResetPlayer } from "@/modules/reset";
import {
  actor,
  clock,
  close,
  count,
  db,
  loadFixtureCatalog,
  resetPlayers,
  unitOfWork,
} from "./harness";

afterAll(close);
beforeAll(loadFixtureCatalog);
beforeEach(() => resetPlayers(["jack", "sam", "admin"]));

const decks = makeDecks({ unitOfWork, clock });
const sharing = makeDeckSharing({
  unitOfWork,
  clock,
  tokens: { newPublicToken: () => randomBytes(16).toString("base64url") },
});
const resetPlayer = makeResetPlayer({ unitOfWork, clock });
const jack = actor("jack");
const sam = actor("sam");
const admin = actor("admin", true);

async function give(userId: string, name: string, quantity: number): Promise<void> {
  await db.execute(sql`
    insert into collection_cards (user_id, printing_id, finish, quantity)
    select ${userId}, p.id, 'nonfoil', ${quantity} from printings p
     where p.name = ${name} order by p.collector_number limit 1
  `);
}

async function deck(name: string, list: string): Promise<DeckId> {
  const created = await decks.createDeck(jack, { name, format: "casual" });
  if (!created.ok) throw new Error(created.error.kind);
  await decks.importList(jack, { deckId: created.value, text: list });
  return created.value;
}

describe("sharing a deck", () => {
  it("hides a private deck from everyone else, and shows a shared one with their copies", async () => {
    const deckId = await deck("Lights", "4 Banishing Light\n10 Plains");
    await give("jack", "Banishing Light", 1);
    await give("sam", "Banishing Light", 3);

    expect(await deckForViewer(db, sam.userId, deckId)).toBeNull();
    expect((await deckForViewer(db, jack.userId, deckId))?.isOwner).toBe(true);

    await sharing.setVisibility(jack, { deckId, visibility: "shared" });
    const seen = await deckForViewer(db, sam.userId, deckId);
    expect(seen).toMatchObject({ isOwner: false, ownerName: "jack", visibility: "shared" });
    // The owner's copies in the lines; the viewer's in yourCopies.
    const light = seen?.view.lines.find((line) => line.name === "Banishing Light");
    expect(light?.owned).toBe(1);
    expect(light && seen?.yourCopies[light.oracleId]).toBe(3);

    expect(await sharedDecks(db)).toMatchObject([
      { name: "Lights", ownerName: "jack", cards: 14, comments: 0 },
    ]);
    expect((await decksFor(db, jack.userId))[0].visibility).toBe("shared");
    const feed = await activityFeed(db);
    expect(feed[0]).toMatchObject({ kind: "deckShared", actor: "jack", deckName: "Lights" });
  });

  it("drops the deck's feed items while it's private, and brings them back when shared again", async () => {
    const deckId = await deck("Lights", "4 Banishing Light");
    await sharing.setVisibility(jack, { deckId, visibility: "shared" });
    await sharing.postComment(sam, { deckId, body: "Nice" });
    const aboutLights = async () =>
      (await activityFeed(db)).filter(
        (item) =>
          (item.kind === "deckShared" || item.kind === "deckComment") && item.deckId === deckId,
      );
    expect((await aboutLights()).map((item) => item.kind)).toEqual(["deckComment", "deckShared"]);

    await sharing.setVisibility(jack, { deckId, visibility: "private" });
    expect(await aboutLights()).toEqual([]);

    await sharing.setVisibility(jack, { deckId, visibility: "shared" });
    expect(await aboutLights()).toHaveLength(2);
  });
});

describe("comments", () => {
  it("are posted, listed with names, tell the owner, and deleted without their text", async () => {
    const deckId = await deck("Lights", "4 Banishing Light");
    await sharing.setVisibility(jack, { deckId, visibility: "shared" });
    const first = await sharing.postComment(sam, { deckId, body: "Needs more removal" });
    await sharing.postComment(jack, { deckId, body: "Agreed" });
    if (!first.ok) throw new Error(first.error.kind);

    expect((await activityFeed(db))[0]).toMatchObject({
      kind: "deckComment",
      actor: "sam",
      other: "jack",
      deckName: "Lights",
    });
    expect(
      (await deckComments(db, deckId)).map((comment) => [comment.authorName, comment.body]),
    ).toEqual([
      ["sam", "Needs more removal"],
      ["jack", "Agreed"],
    ]);

    expect((await sharing.deleteComment(admin, first.value)).ok).toBe(true);
    expect((await deckComments(db, deckId))[0]).toMatchObject({ authorName: "sam", body: null });
    expect((await sharedDecks(db))[0].comments).toBe(1);
    expect(await sharing.deleteComment(sam, CommentId.of(9999))).toEqual({
      ok: false,
      error: { kind: "CommentNotFound" },
    });
  });

  it("can't be posted on a private deck by someone else", async () => {
    const deckId = await deck("Secret", "1 Banishing Light");
    expect(await sharing.postComment(sam, { deckId, body: "Hi" })).toEqual({
      ok: false,
      error: { kind: "DeckNotFound" },
    });
  });
});

describe("cards to get (invariant 6)", () => {
  it("needs what the hungriest deck needs, minus what you own; never basics", async () => {
    const first = await deck("Four", "4 Banishing Light\n20 Plains");
    const second = await deck("Two", "2 Banishing Light\n1 Carrot Cake");
    await give("jack", "Banishing Light", 1);

    const toGet = await cardsToGetFor(db, jack.userId);
    expect(
      toGet.cards.map((card) => [
        card.name,
        card.missing,
        card.needed,
        card.decks.map((one) => one.id),
      ]),
    ).toEqual([
      ["Banishing Light", 3, 4, [first, second]],
      ["Carrot Cake", 1, 1, [second]],
    ]);
    // Buy a list skips the copies you own, so the list asks for the deck's own count.
    expect(toGet.listText).toBe("4 Banishing Light\n1 Carrot Cake");
    const light = toGet.cards[0];
    expect(light.priceCents).toBe(12);
    expect(toGet.totalCents).toBe(3 * 12 + 1 * (toGet.cards[1].priceCents ?? 0));
  });
});

describe("resetting a player (invariant 7)", () => {
  it("deletes their decks with their comments, forgets 'shared', and keeps their comments elsewhere", async () => {
    const jacksDeck = await deck("Lights", "1 Banishing Light");
    await sharing.setVisibility(jack, { deckId: jacksDeck, visibility: "shared" });
    const samsDeck = await decks.createDeck(sam, { name: "Sam's", format: "casual" });
    if (!samsDeck.ok) throw new Error(samsDeck.error.kind);
    await sharing.setVisibility(sam, { deckId: samsDeck.value, visibility: "shared" });
    await sharing.postComment(sam, { deckId: jacksDeck, body: "On Jack's deck" });
    await sharing.postComment(jack, { deckId: samsDeck.value, body: "On Sam's deck" });

    expect((await resetPlayer(admin, jack.userId)).ok).toBe(true);
    expect(await count("deck_comments", `deck_id = ${jacksDeck}`)).toBe(0);
    expect((await deckComments(db, samsDeck.value)).map((comment) => comment.body)).toEqual([
      "On Sam's deck",
    ]);
    const feed = await activityFeed(db);
    expect(feed.some((item) => item.kind === "deckShared" && item.actor === "jack")).toBe(false);
    expect(feed.some((item) => item.kind === "deckShared" && item.actor === "sam")).toBe(true);
    // Sam's comment on Jack's deleted deck would link nowhere, so it's gone from the feed too;
    // Jack's comment on Sam's deck stays.
    expect(feed.some((item) => item.kind === "deckComment" && item.deckId === jacksDeck)).toBe(
      false,
    );
    expect(feed.some((item) => item.kind === "deckComment" && item.deckId === samsDeck.value)).toBe(
      true,
    );
  });
});

describe("public deck links (design doc 47)", () => {
  it("loads a private deck by its token, and invalidates old tokens on rotate or revoke", async () => {
    const deckId = await deck("Public Lights", "4 Banishing Light\n10 Plains");
    const enabled = await sharing.enablePublicLink(jack, { deckId });
    expect(enabled.ok).toBe(true);
    if (!enabled.ok) return;

    const loaded = await publicDeckByToken(db, enabled.value);
    expect(loaded?.ownerName).toBe("jack");
    expect(loaded?.view.deck.name).toBe("Public Lights");
    expect(await sharedDecks(db)).toEqual([]);

    const rotated = await sharing.rotatePublicLink(jack, { deckId });
    expect(rotated.ok).toBe(true);
    if (!rotated.ok) return;
    expect(rotated.value).not.toBe(enabled.value);
    expect(await publicDeckByToken(db, enabled.value)).toBeNull();
    expect((await publicDeckByToken(db, rotated.value))?.view.deck.id).toBe(deckId);

    await sharing.revokePublicLink(jack, { deckId });
    expect(await publicDeckByToken(db, rotated.value)).toBeNull();
  });

  it("copies a shared or public deck into the viewer's own decks (design doc 48)", async () => {
    const deckId = await deck("Shared Lights", "4 Banishing Light\n10 Plains");
    await sharing.setVisibility(jack, { deckId, visibility: "shared" });

    const copied = await decks.copyDeck(sam, { kind: "deck", deckId });
    expect(copied.ok).toBe(true);
    if (!copied.ok) return;

    const samsView = await deckForViewer(db, sam.userId, copied.value);
    expect(samsView?.isOwner).toBe(true);
    expect(samsView?.view.deck.name).toBe("Shared Lights (copy)");
    expect(samsView?.view.lines.map((line) => [line.name, line.quantity])).toEqual([
      ["Banishing Light", 4],
      ["Plains", 10],
    ]);
  });
});
