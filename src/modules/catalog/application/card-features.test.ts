import { describe, expect, it } from "vitest";
import { fixedClock, inMemoryUnitOfWork } from "@/shared/kernel/testing";
import { allFixtureCards } from "../../../../tests/fixtures/features/cards";
import { extractFeatures } from "../domain/features/registry";
import { FEATURES_VERSION } from "../domain/features/version";
import { inMemoryCardFeatureStore } from "../testing/fakes";
import { makeFeaturesPass } from "./card-features";
import type { CatalogDependencies, CatalogServices } from "./ports";

function setup() {
  const store = inMemoryCardFeatureStore(allFixtureCards());
  const services = { cardFeatures: store } as unknown as CatalogServices;
  const dependencies = {
    unitOfWork: inMemoryUnitOfWork(services),
    clock: fixedClock(new Date("2026-11-19T00:00:00Z")),
  } as unknown as CatalogDependencies;
  return { store, ...makeFeaturesPass(dependencies) };
}

describe("the features pass", () => {
  it("works out every card once and stores what extractFeatures says", async () => {
    const { store, featuresPass } = setup();
    expect(await featuresPass()).toBe(allFixtureCards().length);
    expect(await featuresPass()).toBe(0);
    const sol = allFixtureCards().find((card) => card.name === "Sol Ring");
    if (sol === undefined) throw new Error("fixture missing");
    expect(store.rows.get(sol.oracleId)).toEqual(extractFeatures(sol));
  });

  it("works a card out again when its stored version is older", async () => {
    const { store, featuresPass } = setup();
    await featuresPass();
    const [first] = allFixtureCards();
    store.rows.set(first.oracleId, {
      ...extractFeatures(first),
      featuresVersion: FEATURES_VERSION - 1,
    });
    expect(await featuresPass()).toBe(1);
    expect(store.rows.get(first.oracleId)?.featuresVersion).toBe(FEATURES_VERSION);
  });
});
