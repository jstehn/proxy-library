import { describe, expect, it } from "vitest";
import { plainText } from "./plain-text";

describe("plainText", () => {
  it("drops reminder text", () => {
    expect(plainText("Flying (This creature can't be blocked except by flyers.)")).toBe("Flying ");
  });

  it("replaces face names and the part before a comma with ~, longest first", () => {
    expect(
      plainText("Put four +1/+1 counters on Jolene. (Reminder.)", ["Jolene, the Plunder Queen"]),
    ).toBe("Put four +1/+1 counters on ~. ");
    expect(plainText("Ojer Kaslem, Deepest Growth dies", ["Ojer Kaslem, Deepest Growth"])).toBe(
      "~ dies",
    );
  });
});
