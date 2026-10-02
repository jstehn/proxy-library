import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { randomInt, seededRng, shuffled, weightedPick, weightedSample, type Weighted } from "./rng";

const take = (seed: string, n: number) => {
  const rng = seededRng(seed);
  return Array.from({ length: n }, () => rng.next());
};

describe("seededRng", () => {
  it("is deterministic per seed", () => {
    expect(take("pack-42", 5)).toEqual(take("pack-42", 5));
  });

  it("differs between seeds", () => {
    expect(take("pack-42", 5)).not.toEqual(take("pack-43", 5));
  });

  it("stays within [0, 1)", () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        for (const value of take(seed, 50)) {
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThan(1);
        }
      }),
    );
  });

  it("is roughly uniform (mean of many draws near 0.5)", () => {
    const values = take("uniformity", 100_000);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean).toBeCloseTo(0.5, 2);
  });
});

describe("randomInt", () => {
  it("returns integers in [0, max)", () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 1, max: 1000 }), (seed, max) => {
        const value = randomInt(seededRng(seed), max);
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(max);
      }),
    );
  });

  it("rejects non-positive bounds", () => {
    expect(() => randomInt(seededRng("x"), 0)).toThrow(RangeError);
  });
});

describe("weightedPick", () => {
  it("never picks zero-weight items", () => {
    const rng = seededRng("zero-weights");
    const options: Weighted<string>[] = [
      { item: "never", weight: 0 },
      { item: "always", weight: 3 },
      { item: "never-either", weight: 0 },
    ];
    for (let i = 0; i < 1000; i++) expect(weightedPick(rng, options)).toBe("always");
  });

  it("matches the weights statistically (mythic 1 : rare 7)", () => {
    const rng = seededRng("rarity-odds");
    const options: Weighted<string>[] = [
      { item: "mythic", weight: 1 },
      { item: "rare", weight: 7 },
    ];
    const draws = 80_000;
    let mythics = 0;
    for (let i = 0; i < draws; i++) if (weightedPick(rng, options) === "mythic") mythics++;
    // Expected 1/8 = 0.125; binomial standard error ≈ 0.0012, so ±0.005 is > 4 sigma.
    expect(Math.abs(mythics / draws - 0.125)).toBeLessThan(0.005);
  });

  it.each([
    [[]],
    [[{ item: "a", weight: 0 }]],
    [[{ item: "a", weight: -1 }]],
    [[{ item: "a", weight: Number.NaN }]],
  ])("rejects invalid weights %j", (options) => {
    expect(() => weightedPick(seededRng("x"), options)).toThrow(RangeError);
  });
});

describe("weightedSample", () => {
  const optionsArb = fc
    .uniqueArray(fc.integer({ min: 0, max: 10_000 }), { minLength: 1 })
    .chain((items) =>
      fc.tuple(
        fc.constant(items.map((item, i) => ({ item, weight: (i % 5) + 1 }))),
        fc.integer({ min: 0, max: items.length }),
        fc.string(),
      ),
    );

  it("draws exactly `count` distinct items from the options", () => {
    fc.assert(
      fc.property(optionsArb, ([options, count, seed]) => {
        const drawn = weightedSample(seededRng(seed), options, count);
        expect(drawn).toHaveLength(count);
        expect(new Set(drawn).size).toBe(count);
        const pool = new Set(options.map((o) => o.item));
        for (const item of drawn) expect(pool.has(item)).toBe(true);
      }),
    );
  });

  it("does not mutate its input", () => {
    const options = [
      { item: "a", weight: 1 },
      { item: "b", weight: 1 },
    ];
    const copy = structuredClone(options);
    weightedSample(seededRng("x"), options, 2);
    expect(options).toEqual(copy);
  });

  it("rejects drawing more items than have positive weight", () => {
    const options = [
      { item: "a", weight: 1 },
      { item: "b", weight: 0 },
    ];
    expect(() => weightedSample(seededRng("x"), options, 2)).toThrow(RangeError);
  });
});

describe("shuffled", () => {
  it("keeps every item, leaves the input alone, and repeats for the same seed", () => {
    fc.assert(
      fc.property(fc.string(), fc.array(fc.integer()), (seed, items) => {
        const before = [...items];
        const result = shuffled(seededRng(seed), items);
        expect(items).toEqual(before);
        expect([...result].sort((a, b) => a - b)).toEqual([...items].sort((a, b) => a - b));
        expect(shuffled(seededRng(seed), items)).toEqual(result);
      }),
    );
  });

  it("puts each item first about equally often", () => {
    const rng = seededRng("fair");
    const firsts = [0, 0, 0, 0];
    for (let i = 0; i < 8000; i++) firsts[shuffled(rng, [0, 1, 2, 3])[0]] += 1;
    // 2000 expected each; 6 standard deviations (about ±230) can't happen by chance.
    for (const count of firsts) expect(Math.abs(count - 2000)).toBeLessThan(230);
  });
});
