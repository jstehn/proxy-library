import { describe, expect, it } from "vitest";
import { EMPTY_DECK_PROFILE, withoutAvoidCards } from "./deck-profile";

describe("withoutAvoidCards", () => {
  const profile = {
    ...EMPTY_DECK_PROFILE,
    avoid: [{ cardName: "Mortuary", reason: "Breaks Avacyn and reanimation" }],
  };

  it("leaves the profile's avoid cards out, matching names in any case, and names them once", () => {
    const split = withoutAvoidCards(
      [{ name: "Mortuary" }, { name: "Zulaport Cutthroat" }, { name: "mortuary" }],
      (card) => card.name,
      profile,
    );
    expect(split.kept).toEqual([{ name: "Zulaport Cutthroat" }]);
    expect(split.avoided).toEqual(["Mortuary", "mortuary"]);
  });

  it("keeps everything when the deck has no profile", () => {
    const split = withoutAvoidCards([{ name: "Mortuary" }], (card) => card.name, null);
    expect(split.kept).toHaveLength(1);
    expect(split.avoided).toEqual([]);
  });
});
