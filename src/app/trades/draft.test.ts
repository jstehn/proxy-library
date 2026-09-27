import { describe, expect, it } from "vitest";
import { adjust, draftHref, readDraft } from "./draft";

describe("trade drafts in the URL", () => {
  it("round-trips through a URL", () => {
    const draft = readDraft({
      with: "bob",
      give: "p1~foil~2,p2~nonfoil~1",
      giveMoney: "2.50",
      mine: "bolt",
    });
    const again = readDraft(
      Object.fromEntries(new URL(`http://x${draftHref(draft)}`).searchParams),
    );
    expect(again).toEqual(draft);
  });

  it("drops cards it can't read", () => {
    expect(readDraft({ give: "p1~shiny~2,p2~foil~0,p3~foil~3" }).give).toEqual([
      { printingId: "p3", finish: "foil", quantity: 3 },
    ]);
  });

  it("adds, removes and caps quantities", () => {
    const card = { printingId: "p1", finish: "nonfoil" as const };
    const one = adjust([], card, 1);
    expect(adjust(one, card, 1)).toEqual([{ ...card, quantity: 2 }]);
    expect(adjust(one, card, -1)).toEqual([]);
    expect(adjust([{ ...card, quantity: 99 }], card, 1)).toEqual([{ ...card, quantity: 99 }]);
  });
});
