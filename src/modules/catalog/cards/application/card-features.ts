import { ok } from "@/shared/kernel";
import { extractFeatures } from "../domain/features/registry";
import { FEATURES_VERSION } from "../domain/features/version";
import type { CardsDependencies } from "./ports";

const BATCH_SIZE = 500;

/** The features pass: works out every oracle card's features that are missing or out of date. */
export function makeFeaturesPass(dependencies: CardsDependencies) {
  const { unitOfWork, clock } = dependencies;

  /** Returns how many oracle cards it worked out. A second run right after returns 0. */
  async function featuresPass(): Promise<number> {
    let computed = 0;
    for (;;) {
      const result = await unitOfWork.run(async ({ cardFeatures }) => {
        if (cardFeatures === undefined) return ok(0);
        const texts = await cardFeatures.textsToCompute(FEATURES_VERSION, BATCH_SIZE);
        const rows = texts.map((text) => ({
          oracleId: text.oracleId,
          features: extractFeatures(text),
        }));
        await cardFeatures.save(rows, clock.now());
        return ok(rows.length);
      });
      if (!result.ok || result.value === 0) return computed;
      computed += result.value;
    }
  }

  return { featuresPass };
}
