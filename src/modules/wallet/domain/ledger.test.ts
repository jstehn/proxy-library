import { describe, expect, it } from "vitest";
import { Cents, UserId } from "@/shared/kernel";
import { checkAmount, checkCanAfford, checkNote, DIRECTION, ledgerEntry } from "./ledger";

const jack = UserId.of("jack");
const now = new Date("2026-01-01T00:00:00Z");

describe("ledgerEntry", () => {
  it("stores money in as positive and a correction as negative (rule 4)", () => {
    expect(
      ledgerEntry({ userId: jack, kind: "grant", size: Cents.of(500), effectiveAt: now }).amount,
    ).toBe(500);
    expect(
      ledgerEntry({ userId: jack, kind: "correction", size: Cents.of(500), effectiveAt: now })
        .amount,
    ).toBe(-500);
  });

  it("covers every kind with a direction", () => {
    for (const kind of Object.keys(DIRECTION)) {
      expect(["in", "out"]).toContain(DIRECTION[kind as keyof typeof DIRECTION]);
    }
  });

  it("refuses a zero or negative size (a bug in the caller)", () => {
    expect(() =>
      ledgerEntry({ userId: jack, kind: "grant", size: Cents.zero, effectiveAt: now }),
    ).toThrow(RangeError);
  });
});

describe("checkAmount (rule 5)", () => {
  it("accepts $0.01 up to $10,000.00", () => {
    expect(checkAmount(Cents.of(1)).ok).toBe(true);
    expect(checkAmount(Cents.of(1_000_000)).ok).toBe(true);
  });

  it("rejects zero, negatives and more than the maximum", () => {
    expect(checkAmount(Cents.zero).ok).toBe(false);
    expect(checkAmount(Cents.of(-100)).ok).toBe(false);
    expect(checkAmount(Cents.of(1_000_001))).toEqual({
      ok: false,
      error: { kind: "AmountInvalid", reason: "must be at most $10,000.00" },
    });
  });

  it("can use a lower maximum", () => {
    expect(checkAmount(Cents.of(10_001), Cents.of(10_000)).ok).toBe(false);
  });
});

describe("checkNote", () => {
  it("trims, and treats blank as missing", () => {
    expect(checkNote("  won the draft  ", { required: true })).toEqual({
      ok: true,
      value: "won the draft",
    });
    expect(checkNote("   ", { required: false })).toEqual({ ok: true, value: null });
    expect(checkNote(undefined, { required: true }).ok).toBe(false);
  });

  it("rejects notes over 200 characters", () => {
    expect(checkNote("x".repeat(201), { required: false }).ok).toBe(false);
  });
});

describe("checkCanAfford (rule 3)", () => {
  it("allows spending the whole balance but not a cent more", () => {
    expect(checkCanAfford(Cents.of(500), Cents.of(500)).ok).toBe(true);
    expect(checkCanAfford(Cents.of(500), Cents.of(501))).toEqual({
      ok: false,
      error: { kind: "InsufficientFunds", balance: 500, required: 501 },
    });
  });
});
