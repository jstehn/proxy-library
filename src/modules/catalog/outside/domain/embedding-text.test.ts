import { describe, expect, it } from "vitest";
import { cleanCardText } from "./embedding-text";

describe("cleanCardText", () => {
  it("puts the type line first, strips reminder text, and replaces card name with ~", () => {
    const result = cleanCardText(
      "Llanowar Elves",
      "Creature — Elf Druid",
      "{T}: Add {G}. (It's not a spell.)",
    );
    expect(result).toBe("Creature — Elf Druid\n{T}: Add {G}.");
  });

  it("replaces comma-prefixed legendary short names with ~", () => {
    const result = cleanCardText(
      "Krenko, Mob Boss",
      "Legendary Creature — Goblin Warrior",
      "{T}: Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control. Krenko gets +1/+1.",
    );
    expect(result).toBe(
      "Legendary Creature — Goblin Warrior\n{T}: Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control. ~ gets +1/+1.",
    );
  });

  it("returns only the type line when rules text is empty or all reminder text", () => {
    expect(cleanCardText("Grizzly Bears", "Creature — Bear", "")).toBe("Creature — Bear");
    expect(
      cleanCardText(
        "Ornithopter",
        "Artifact Creature — Thopter",
        "(This creature can't be blocked.)",
      ),
    ).toBe("Artifact Creature — Thopter");
  });
});
