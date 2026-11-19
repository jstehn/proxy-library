import { describe, expect, it } from "vitest";
import { describeDeckError } from "./describe-error";

describe("describeDeckError", () => {
  it("names the limit an error carries", () => {
    expect(describeDeckError({ kind: "QuantityInvalid", maximum: 99 })).toBe("Use 0 to 99 copies.");
    expect(describeDeckError({ kind: "TooManySnapshots", maximum: 30 })).toContain("30");
  });

  it("lists what a rejected list couldn't use", () => {
    const text = describeDeckError({
      kind: "ListProblems",
      unreadable: ["???"],
      notFound: ["Lightnin Bolt"],
    });
    expect(text).toContain('["???"]');
    expect(text).toContain('["Lightnin Bolt"]');
  });

  it("gives a deck that isn't the player's one plain sentence", () => {
    expect(describeDeckError({ kind: "DeckNotFound" })).toBe("That deck isn't yours.");
  });
});
