import { describe, expect, it } from "vitest";
import type { PrintingId } from "@/modules/catalog";
import type { DeckId } from "@/modules/decks";
import { UserId } from "@/shared/kernel";
import { fixedClock, inMemoryUnitOfWork } from "@/shared/kernel/testing";
import { fakeSocialServices } from "../testing/fakes";
import { makeSocial } from "./make-social";

describe("social use cases", () => {
  const alice = UserId.of("alice");
  const bob = UserId.of("bob");
  const charlie = UserId.of("charlie");
  const deck1 = 1 as DeckId;
  const printing1 = "p1" as PrintingId;
  const printingMissing = "missing" as PrintingId;

  function setup() {
    const services = fakeSocialServices({
      activePlayerIds: [alice, bob],
      ownedSharedDecks: [{ ownerId: alice, deckId: deck1 }],
      existingPrintings: [printing1],
    });
    const social = makeSocial({
      unitOfWork: inMemoryUnitOfWork(services),
      clock: fixedClock("2026-11-12T12:00:00Z"),
    });
    return { services, social };
  }

  it("updates a profile with valid bio, showcase deck, and showcase cards", async () => {
    const { social } = setup();
    const res = await social.updateProfile(alice, {
      bio: "  Commander enjoyer  ",
      favoriteColors: ["G", "W"],
      favoriteFormats: ["commander"],
      showcaseDeckId: deck1,
      showcasePrintingIds: [printing1, printing1],
      statsVisibility: "friends",
      wishlistVisibility: "everyone",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.bio).toBe("Commander enjoyer");
      expect(res.value.favoriteColors).toEqual(["W", "G"]);
      expect(res.value.showcasePrintingIds).toEqual([printing1]);
      expect(res.value.statsVisibility).toBe("friends");
    }
  });

  it("rejects unowned or private showcase deck and missing showcase cards", async () => {
    const { social } = setup();
    const badDeck = await social.updateProfile(bob, {
      bio: "",
      favoriteColors: [],
      favoriteFormats: [],
      showcaseDeckId: deck1,
      showcasePrintingIds: [],
      statsVisibility: "everyone",
      wishlistVisibility: "friends",
    });
    expect(badDeck).toEqual({ ok: false, error: { kind: "InvalidShowcaseDeck" } });

    const badCard = await social.updateProfile(alice, {
      bio: "",
      favoriteColors: [],
      favoriteFormats: [],
      showcaseDeckId: null,
      showcasePrintingIds: [printingMissing],
      statsVisibility: "everyone",
      wishlistVisibility: "friends",
    });
    expect(badCard).toEqual({ ok: false, error: { kind: "InvalidShowcaseCard" } });
  });

  it("handles the full friend request lifecycle", async () => {
    const { social } = setup();

    expect(await social.sendFriendRequest(alice, alice)).toEqual({
      ok: false,
      error: { kind: "CannotFriendSelf" },
    });
    expect(await social.sendFriendRequest(alice, charlie)).toEqual({
      ok: false,
      error: { kind: "PlayerNotFound" },
    });

    const sent = await social.sendFriendRequest(alice, bob);
    expect(sent.ok).toBe(true);

    // Duplicate or reverse request while pending
    expect(await social.sendFriendRequest(alice, bob)).toEqual({
      ok: false,
      error: { kind: "RequestAlreadyPending" },
    });
    expect(await social.sendFriendRequest(bob, alice)).toEqual({
      ok: false,
      error: { kind: "RequestAlreadyPending" },
    });

    // Only addressee can accept
    expect(await social.acceptFriendRequest(alice, bob)).toEqual({
      ok: false,
      error: { kind: "NotAddressee" },
    });

    const accepted = await social.acceptFriendRequest(bob, alice);
    expect(accepted.ok).toBe(true);
    if (accepted.ok) {
      expect(accepted.value.status).toBe("accepted");
    }

    // Already friends
    expect(await social.sendFriendRequest(alice, bob)).toEqual({
      ok: false,
      error: { kind: "AlreadyFriends" },
    });

    // Unfriend
    expect(await social.unfriend(alice, bob)).toEqual({ ok: true, value: undefined });
    expect(await social.unfriend(alice, bob)).toEqual({
      ok: false,
      error: { kind: "FriendshipNotFound" },
    });
  });

  it("supports cancelling and declining pending requests", async () => {
    const { social } = setup();
    await social.sendFriendRequest(alice, bob);

    expect(await social.cancelFriendRequest(bob, alice)).toEqual({
      ok: false,
      error: { kind: "NotRequester" },
    });
    expect(await social.cancelFriendRequest(alice, bob)).toEqual({
      ok: true,
      value: undefined,
    });

    await social.sendFriendRequest(alice, bob);
    expect(await social.declineFriendRequest(alice, bob)).toEqual({
      ok: false,
      error: { kind: "NotAddressee" },
    });
    expect(await social.declineFriendRequest(bob, alice)).toEqual({
      ok: true,
      value: undefined,
    });
  });
});
