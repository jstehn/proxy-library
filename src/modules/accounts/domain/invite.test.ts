import { describe, expect, it } from "vitest";
import { UserId } from "@/shared/kernel";
import { InviteCode, inviteStatus, markRevoked, markUsed, newInvite, type Invite } from "./invite";

const admin = UserId.of("admin-1");
const newcomer = UserId.of("player-2");
const created = new Date("2026-01-01T12:00:00Z");
const code = InviteCode.parse("K7QM-2XPA-9TRD");

function openInvite(): Invite {
  if (code === null) throw new Error("test setup: bad code");
  const result = newInvite({ code, createdBy: admin, now: created, validForDays: 7 });
  if (!result.ok) throw new Error("test setup: bad invite");
  return result.value;
}

describe("InviteCode.parse", () => {
  it("normalizes case and surrounding spaces", () => {
    expect(InviteCode.parse("  k7qm-2xpa-9trd ")).toBe("K7QM-2XPA-9TRD");
  });

  it.each(["", "K7QM2XPA9TRD", "K7QM-2XPA-9TR", "IIII-LLLL-OOOO", "K7QM-2XPA-9TRD-AAAA"])(
    "rejects %j",
    (raw) => {
      expect(InviteCode.parse(raw)).toBeNull();
    },
  );
});

describe("newInvite", () => {
  it("expires the given number of days after creation", () => {
    expect(openInvite().expiresAt.toISOString()).toBe("2026-01-08T12:00:00.000Z");
  });

  it.each([0, 31, 1.5, Number.NaN])("rejects a duration of %s days", (validForDays) => {
    if (code === null) throw new Error("test setup: bad code");
    expect(newInvite({ code, createdBy: admin, now: created, validForDays })).toEqual({
      ok: false,
      error: { kind: "InviteDurationInvalid" },
    });
  });
});

describe("inviteStatus", () => {
  it("is open until the exact expiry instant, then expired", () => {
    const invite = openInvite();
    expect(inviteStatus(invite, new Date("2026-01-08T11:59:59.999Z"))).toBe("open");
    expect(inviteStatus(invite, new Date("2026-01-08T12:00:00.000Z"))).toBe("expired");
  });

  it("reports used and revoked invites, even after expiry", () => {
    const later = new Date("2026-02-01T00:00:00Z");
    const used = markUsed(openInvite(), newcomer, created);
    const revoked = markRevoked(openInvite(), created);
    expect(used.ok && inviteStatus(used.value, later)).toBe("used");
    expect(revoked.ok && inviteStatus(revoked.value, later)).toBe("revoked");
  });
});

describe("markUsed / markRevoked (rule 5: an invite works once)", () => {
  it("records who used it and when", () => {
    const used = markUsed(openInvite(), newcomer, created);
    expect(used.ok && used.value.usedBy).toBe(newcomer);
  });

  it("refuses to use an invite twice", () => {
    const first = markUsed(openInvite(), newcomer, created);
    if (!first.ok) throw new Error("test setup");
    expect(markUsed(first.value, UserId.of("player-3"), created)).toEqual({
      ok: false,
      error: { kind: "InviteNotOpen", status: "used" },
    });
  });

  it("refuses expired and revoked invites", () => {
    const afterExpiry = new Date("2026-01-09T00:00:00Z");
    expect(markUsed(openInvite(), newcomer, afterExpiry)).toEqual({
      ok: false,
      error: { kind: "InviteNotOpen", status: "expired" },
    });
    const revoked = markRevoked(openInvite(), created);
    if (!revoked.ok) throw new Error("test setup");
    expect(markUsed(revoked.value, newcomer, created).ok).toBe(false);
  });
});
