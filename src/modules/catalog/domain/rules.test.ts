import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  isDigitalBoosterType,
  isDigitalCodeExtra,
  isDigitalOnlyDeck,
  isDigitalOnlyProduct,
  isNightlySyncDue,
  isPaperPrinting,
  snapshotDay,
  variantLabel,
} from "./rules";

const plain = {
  borderColor: "black",
  frameVersion: "2015",
  frameEffects: [],
  promoTypes: [],
  isFullArt: false,
};

describe("variantLabel", () => {
  it("is empty for the regular version", () => {
    expect(variantLabel(plain)).toBe("");
  });

  it("names treatments in a fixed order and ignores unknown codes", () => {
    expect(
      variantLabel({
        ...plain,
        borderColor: "borderless",
        frameEffects: ["inverted", "showcase"],
        promoTypes: ["boosterfun", "surgefoil", "somethingnew"],
      }),
    ).toBe("Borderless · Showcase · Surge Foil");
    expect(variantLabel({ ...plain, isFullArt: true })).toBe("Full Art");
    expect(variantLabel({ ...plain, promoTypes: ["serialized"] })).toBe("Serialized");
  });
});

describe("paper only: exclude only what is ONLY digital (rule 9)", () => {
  it("keeps any printing available in paper", () => {
    expect(isPaperPrinting(["arena", "mtgo", "paper"])).toBe(true);
    expect(isPaperPrinting(["paper"])).toBe(true);
    expect(isPaperPrinting(["arena"])).toBe(false);
    expect(isPaperPrinting(["mtgo", "arena"])).toBe(false);
  });

  it("skips only digital booster types", () => {
    for (const kept of [
      "play",
      "draft",
      "set",
      "collector",
      "collector-sample",
      "prerelease",
      "jumpstart",
    ]) {
      expect(isDigitalBoosterType(kept)).toBe(false);
    }
    for (const skipped of ["play-arena", "draft-arena", "jumpstart-arena", "draft-mtgo"]) {
      expect(isDigitalBoosterType(skipped)).toBe(true);
    }
  });

  it("keeps Commander decks and starter kits; skips only MTGO redemption", () => {
    expect(isDigitalOnlyProduct({ subtype: "commander" })).toBe(false);
    expect(isDigitalOnlyProduct({ subtype: "two_player_starter" })).toBe(false);
    expect(isDigitalOnlyProduct({ subtype: "mtgo_redemption" })).toBe(true);
    expect(isDigitalOnlyDeck({ type: "Commander Deck" })).toBe(false);
    expect(isDigitalOnlyDeck({ type: "MTGO Redemption" })).toBe(true);
  });

  it("recognizes digital code inserts among a product's extras", () => {
    expect(isDigitalCodeExtra("2 MTG Arena codes")).toBe(true);
    expect(isDigitalCodeExtra("Bloomburrow Spindown")).toBe(false);
    expect(isDigitalCodeExtra("Card-storage box")).toBe(false);
  });
});

describe("isNightlySyncDue (server-local 04:00)", () => {
  const at = (day: number, hour: number, minute = 0) => new Date(2026, 0, day, hour, minute); // local time
  const syncTime = { hour: 4, minute: 0 };

  it("is not due before today's sync time", () => {
    expect(isNightlySyncDue({ lastRunStartedAt: at(4, 4), now: at(5, 3, 59), syncTime })).toBe(
      false,
    );
  });

  it("is due after today's sync time if the last run was before it", () => {
    expect(isNightlySyncDue({ lastRunStartedAt: at(4, 4), now: at(5, 4, 1), syncTime })).toBe(true);
    expect(isNightlySyncDue({ lastRunStartedAt: null, now: at(5, 12), syncTime })).toBe(true);
  });

  it("is not due again once today's run has started", () => {
    expect(isNightlySyncDue({ lastRunStartedAt: at(5, 4, 1), now: at(5, 23), syncTime })).toBe(
      false,
    );
  });

  it("fires at most once per day, whenever the worker checks", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 24 * 60 * 3 }), { maxLength: 200 }),
        (minutes) => {
          const checks = [...minutes].sort((a, b) => a - b).map((m) => new Date(2026, 0, 5, 0, m));
          let lastRunStartedAt: Date | null = at(4, 4);
          const runDays = new Set<string>();
          for (const now of checks) {
            if (isNightlySyncDue({ lastRunStartedAt, now, syncTime })) {
              const day = now.toDateString();
              expect(runDays.has(day)).toBe(false);
              runDays.add(day);
              lastRunStartedAt = now;
            }
          }
        },
      ),
    );
  });
});

describe("snapshotDay", () => {
  it("is the UTC date", () => {
    expect(snapshotDay(new Date("2026-09-27T23:30:00Z"))).toBe("2026-09-27");
  });
});
