import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/modules/accounts";
import { err, UserId } from "@/shared/kernel";
import { inMemoryPacksServices } from "../testing/fakes";
import { SAMPLE_BOOSTER, SAMPLE_FACTS, sampleSheet } from "../testing/recipes";
import { makePacks } from "./make-packs";
import { openBooster } from "./open-booster";
import { packSeed } from "./simulate";

// Use-case tests: the real pack code against an in-memory BoosterSource and predictable seeds.

function actor(isAdmin: boolean): Actor {
  return {
    userId: UserId.of(isAdmin ? "admin" : "jack"),
    username: "someone" as Actor["username"],
    displayName: "Someone" as Actor["displayName"],
    isAdmin,
    canSelfFund: false,
    mustChangePassword: false,
  };
}

const admin = actor(true);
const player = actor(false);
const sample = { setCode: SAMPLE_BOOSTER.setCode, boosterType: "play" };

let setup: ReturnType<typeof inMemoryPacksServices>;
let packs: ReturnType<typeof makePacks>;

beforeEach(() => {
  setup = inMemoryPacksServices([SAMPLE_BOOSTER], SAMPLE_FACTS);
  packs = makePacks({ unitOfWork: setup.unitOfWork, seeds: setup.seeds });
});

describe("openBooster", () => {
  it("opens the same pack for the same seed", async () => {
    const first = await openBooster(setup.services, { ...sample, seed: "abc" });
    const again = await openBooster(setup.services, { ...sample, seed: "abc" });
    expect(first.ok && first.value.cards).toHaveLength(14);
    expect(again).toEqual(first);
  });

  it("refuses a booster that doesn't exist", async () => {
    const result = await openBooster(setup.services, { ...sample, boosterType: "nope", seed: "x" });
    expect(result).toEqual(err({ kind: "BoosterUnavailable" }));
  });
});

describe("simulateOpenings", () => {
  it("is for admins only", async () => {
    const result = await packs.simulateOpenings(player, { ...sample, count: 10 });
    expect(result).toEqual(err({ kind: "Forbidden" }));
  });

  it.each([0, 1_001, 2.5])("refuses %s packs", async (count) => {
    const result = await packs.simulateOpenings(admin, { ...sample, count });
    expect(result).toEqual(err({ kind: "CountInvalid" }));
  });

  it("refuses a booster that doesn't exist", async () => {
    const result = await packs.simulateOpenings(admin, { ...sample, boosterType: "x", count: 1 });
    expect(result).toEqual(err({ kind: "BoosterUnavailable" }));
  });

  it("opens the packs from one fresh seed, so the whole run can be replayed", async () => {
    const result = await packs.simulateOpenings(admin, { ...sample, count: 50 });
    if (!result.ok) throw new Error("expected a report");
    expect(result.value.seed).toBe("seed-1");
    expect(result.value.packCount).toBe(50);

    const secondPack = await openBooster(setup.services, {
      ...sample,
      seed: packSeed("seed-1", 2),
    });
    expect(secondPack.ok && secondPack.value).toEqual(result.value.samplePacks[1]);
  });
});

describe("checkBoosters", () => {
  it("finds nothing wrong with a good recipe", async () => {
    const checks = await packs.checkBoosters(100);
    expect(checks).toEqual([{ ...sample, packsOpened: 100, problems: [] }]);
  });

  it("reports a recipe that can't be opened instead of throwing", async () => {
    // A sheet using a card the catalog doesn't have (catalog rule 5 should prevent this).
    const broken = {
      ...SAMPLE_BOOSTER,
      boosterType: "broken",
      variants: [{ weight: 1, slots: { ghost: 1 } }],
      sheets: { ghost: sampleSheet([["not-in-catalog", 1]]) },
    };
    setup = inMemoryPacksServices([broken], SAMPLE_FACTS);
    packs = makePacks({ unitOfWork: setup.unitOfWork, seeds: setup.seeds });

    const [check] = await packs.checkBoosters(10);
    expect(check.problems).toEqual([
      { problem: expect.stringMatching(/^could not open: No facts for printing/), packs: 10 },
    ]);
  });
});
