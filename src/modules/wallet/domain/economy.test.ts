import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Cents } from "@/shared/kernel";
import { checkSettings, nextPayday, paydaysBetween, type EconomySettings } from "./economy";

// Monday 2026-01-05 00:00 UTC, every 7 days.
const weekly = { anchor: new Date("2026-01-05T00:00:00Z"), periodDays: 7 };
const iso = (dates: Date[]) => dates.map((date) => date.toISOString());

describe("paydaysBetween", () => {
  it("lists every payday after `after`, up to and including `upTo`", () => {
    expect(
      iso(
        paydaysBetween(weekly, new Date("2026-01-01T00:00:00Z"), new Date("2026-01-20T00:00:00Z")),
      ),
    ).toEqual(["2026-01-05T00:00:00.000Z", "2026-01-12T00:00:00.000Z", "2026-01-19T00:00:00.000Z"]);
  });

  it("excludes a payday exactly at `after` and includes one exactly at `upTo`", () => {
    const monday = new Date("2026-01-12T00:00:00Z");
    expect(iso(paydaysBetween(weekly, monday, monday))).toEqual([]);
    expect(iso(paydaysBetween(weekly, new Date("2026-01-11T23:59:59Z"), monday))).toEqual([
      "2026-01-12T00:00:00.000Z",
    ]);
  });

  it("works when the anchor is in the future", () => {
    // 2030-01-07 is exactly 209 weeks after 2026-01-05, so that Monday is a payday too.
    const future = { anchor: new Date("2030-01-07T00:00:00Z"), periodDays: 7 };
    const paydays = paydaysBetween(
      future,
      new Date("2026-01-01T00:00:00Z"),
      new Date("2026-01-10T00:00:00Z"),
    );
    expect(iso(paydays)).toEqual(["2026-01-05T00:00:00.000Z"]);
  });

  it("returns nothing when the window is empty or backwards", () => {
    const now = new Date("2026-03-01T00:00:00Z");
    expect(paydaysBetween(weekly, now, now)).toEqual([]);
    expect(paydaysBetween(weekly, now, new Date("2026-02-01T00:00:00Z"))).toEqual([]);
  });

  // Property tests: rules that must hold for any schedule and any window.
  const date = fc.date({
    min: new Date("2020-01-01T00:00:00Z"),
    max: new Date("2035-01-01T00:00:00Z"),
    noInvalidDate: true,
  });
  const schedule = fc.record({ anchor: date, periodDays: fc.integer({ min: 1, max: 60 }) });

  it("returns paydays that are inside the window and strictly increasing", () => {
    fc.assert(
      fc.property(schedule, date, date, (s, a, b) => {
        const [after, upTo] = a <= b ? [a, b] : [b, a];
        const paydays = paydaysBetween(s, after, upTo);
        for (let i = 0; i < paydays.length; i++) {
          expect(paydays[i].getTime()).toBeGreaterThan(after.getTime());
          expect(paydays[i].getTime()).toBeLessThanOrEqual(upTo.getTime());
          if (i > 0) expect(paydays[i].getTime()).toBeGreaterThan(paydays[i - 1].getTime());
        }
      }),
    );
  });

  it("never pays twice or skips a payday when a window is split in two", () => {
    fc.assert(
      fc.property(schedule, date, date, date, (s, x, y, z) => {
        const [a, b, c] = [x, y, z].sort((p, q) => p.getTime() - q.getTime());
        const split = [...paydaysBetween(s, a, b), ...paydaysBetween(s, b, c)];
        expect(iso(split)).toEqual(iso(paydaysBetween(s, a, c)));
      }),
    );
  });
});

describe("nextPayday", () => {
  it("is the first payday strictly after now", () => {
    expect(nextPayday(weekly, new Date("2026-01-12T00:00:00Z")).toISOString()).toBe(
      "2026-01-19T00:00:00.000Z",
    );
    expect(nextPayday(weekly, new Date("2026-01-13T08:30:00Z")).toISOString()).toBe(
      "2026-01-19T00:00:00.000Z",
    );
  });
});

describe("checkSettings", () => {
  const valid: EconomySettings = {
    allowance: Cents.of(2000),
    allowancePeriodDays: 7,
    allowanceAnchor: weekly.anchor,
    startingGrant: Cents.of(5000),
    selfFundLimit: Cents.of(10_000),
  };

  it("accepts sensible settings, including a $0 allowance (paused)", () => {
    expect(checkSettings(valid).ok).toBe(true);
    expect(checkSettings({ ...valid, allowance: Cents.zero }).ok).toBe(true);
  });

  it.each([
    ["a negative allowance", { allowance: Cents.of(-1) }],
    ["a zero-day period", { allowancePeriodDays: 0 }],
    ["a fractional period", { allowancePeriodDays: 1.5 }],
    ["a zero self-funding limit", { selfFundLimit: Cents.zero }],
    ["an invalid payday", { allowanceAnchor: new Date("nonsense") }],
  ])("rejects %s", (_label, change) => {
    expect(checkSettings({ ...valid, ...change }).ok).toBe(false);
  });
});
