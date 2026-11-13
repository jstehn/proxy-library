import { describe, expect, it } from "vitest";
import { UserId } from "@/shared/kernel";
import { newFriendRequest, viewerRelation } from "./friendship";

describe("friendship domain", () => {
  const alice = UserId.of("alice");
  const bob = UserId.of("bob");
  const now = new Date("2026-11-12T00:00:00Z");

  it("computes viewerRelation for all states", () => {
    expect(viewerRelation(alice, alice, null)).toBe("self");
    expect(viewerRelation(alice, bob, null)).toBe("none");

    const pending = newFriendRequest({ requesterId: alice, addresseeId: bob, now });
    expect(viewerRelation(alice, bob, pending)).toBe("pending_outgoing");
    expect(viewerRelation(bob, alice, pending)).toBe("pending_incoming");

    const accepted = { ...pending, status: "accepted" as const, acceptedAt: now };
    expect(viewerRelation(alice, bob, accepted)).toBe("friend");
    expect(viewerRelation(bob, alice, accepted)).toBe("friend");
  });
});
