import { describe, expect, it } from "vitest";
import { UserId } from "@/shared/kernel";
import {
  canDeleteComment,
  canViewDeck,
  cardsToGet,
  checkCommentBody,
  isValidPublicToken,
  MAX_COMMENT_LENGTH,
} from "./sharing";

const jack = UserId.of("jack");
const sam = UserId.of("sam");
const ada = UserId.of("ada");

describe("comments", () => {
  it("are trimmed, and 1 to 1 000 characters", () => {
    expect(checkCommentBody("  Nice curve!  ")).toEqual({ ok: true, value: "Nice curve!" });
    expect(checkCommentBody("   ").ok).toBe(false);
    expect(checkCommentBody("x".repeat(MAX_COMMENT_LENGTH)).ok).toBe(true);
    expect(checkCommentBody("x".repeat(MAX_COMMENT_LENGTH + 1))).toEqual({
      ok: false,
      error: { kind: "CommentInvalid", maximum: MAX_COMMENT_LENGTH },
    });
  });
});

describe("policies", () => {
  it("shows a private deck to its owner only, a shared one to everyone (invariant 1)", () => {
    expect(canViewDeck(jack, { ownerId: jack, visibility: "private" })).toBe(true);
    expect(canViewDeck(sam, { ownerId: jack, visibility: "private" })).toBe(false);
    expect(canViewDeck(sam, { ownerId: jack, visibility: "shared" })).toBe(true);
  });

  it("lets the author, the deck's owner and admins delete a comment (invariant 4)", () => {
    const deck = { ownerId: jack };
    const bySam = { authorId: sam };
    expect(canDeleteComment({ userId: sam, isAdmin: false }, bySam, deck)).toBe(true);
    expect(canDeleteComment({ userId: jack, isAdmin: false }, bySam, deck)).toBe(true);
    expect(canDeleteComment({ userId: ada, isAdmin: true }, bySam, deck)).toBe(true);
    expect(canDeleteComment({ userId: ada, isAdmin: false }, bySam, deck)).toBe(false);
  });
});

describe("cardsToGet (invariant 6)", () => {
  it("needs the most any one deck needs, not the sum", () => {
    const needs = [
      { deckId: 1, oracleId: "bolt", quantity: 4 },
      { deckId: 2, oracleId: "bolt", quantity: 2 },
      { deckId: 2, oracleId: "ring", quantity: 1 },
    ];
    expect(cardsToGet(needs, new Map([["bolt", 1]]))).toEqual([
      { oracleId: "bolt", missing: 3, deckIds: [1, 2] },
      { oracleId: "ring", missing: 1, deckIds: [2] },
    ]);
  });

  it("adds a card's lines within one deck (main and sideboard)", () => {
    const needs = [
      { deckId: 1, oracleId: "bolt", quantity: 3 },
      { deckId: 1, oracleId: "bolt", quantity: 1 },
    ];
    expect(cardsToGet(needs, new Map())).toEqual([{ oracleId: "bolt", missing: 4, deckIds: [1] }]);
  });

  it("lists only the decks still short, and nothing when you own enough", () => {
    const needs = [
      { deckId: 1, oracleId: "bolt", quantity: 4 },
      { deckId: 2, oracleId: "bolt", quantity: 2 },
    ];
    expect(cardsToGet(needs, new Map([["bolt", 2]]))).toEqual([
      { oracleId: "bolt", missing: 2, deckIds: [1] },
    ]);
    expect(cardsToGet(needs, new Map([["bolt", 4]]))).toEqual([]);
  });
});

describe("public link tokens (design doc 47)", () => {
  it("accepts URL-safe base64url tokens and rejects short or malformed strings", () => {
    expect(isValidPublicToken("abcDEF0123456789_-abcd")).toBe(true);
    expect(isValidPublicToken("")).toBe(false);
    expect(isValidPublicToken("too-short")).toBe(false);
    expect(isValidPublicToken("has spaces or /slashes!")).toBe(false);
    expect(isValidPublicToken("a".repeat(65))).toBe(false);
  });
});
