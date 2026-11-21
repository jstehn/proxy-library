import { describe, expect, it } from "vitest";
import { countClones, normalize } from "./clones";

const first = `const total = addItems(cart, discount);
return total.value;`;
const second = `const sum = combine(basket, rebate);
return sum.amount;`;

describe("normalize", () => {
  it("keeps names in the exact mode, so renamed copies differ", () => {
    expect(normalize(first).map((line) => line.text)).not.toEqual(
      normalize(second).map((line) => line.text),
    );
  });

  it("flattens names in the near mode, so copies that differ only in names match", () => {
    const flat = (source: string) => normalize(source, "near").map((line) => line.text);
    expect(flat(first)).toEqual(flat(second));
    expect(flat(first)[1]).toBe("returni.i;");
  });

  it("keeps keywords in the near mode", () => {
    expect(normalize("if (ready) throw new Error(1);", "near")[0]?.text).toBe("if(i)thrownewi(0);");
  });
});

describe("countClones", () => {
  const body = Array.from(
    { length: 10 },
    (_, index) => `const value${index} = compute${index}(argumentNumber${index});`,
  );
  const files = new Map([
    ["a.ts", body.join("\n")],
    ["b.ts", body.map((line) => line.replace(/value/g, "other")).join("\n")],
  ]);

  it("finds renamed copies only in the near mode", () => {
    expect(countClones(files, "exact").count).toBe(0);
    expect(countClones(files, "near").count).toBeGreaterThan(0);
  });
});
