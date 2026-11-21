import { sigmoid, type RatingFeatureVector } from "./rate";
import { RATING_BIAS, type RatingWeights } from "./rating-weights";

// Offline calibration of the card rating's weights (design doc 46): `scripts/dev/fit-rating-weights.ts`
// fits them to samples; the app only reads the fitted numbers.

export type CalibrationSample = Readonly<{
  features: RatingFeatureVector;
  label: 0 | 1;
}>;

export type FitLogisticOptions = Readonly<{
  learningRate?: number;
  epochs?: number;
  l2?: number;
}>;

type TrainableKey =
  | "synergy"
  | "theme"
  | "tribe"
  | "keyword"
  | "embedSim"
  | "roleNeed"
  | "edhrecLift"
  | "edhrecInclusion"
  | "combo"
  | "quality"
  | "topHeavyPenalty"
  | "saturatedSlotPenalty";

const TRAINABLE_KEYS: readonly {
  weight: TrainableKey;
  feature: keyof RatingFeatureVector;
  sign: 1 | -1;
  maxAbs: number;
}[] = [
  { weight: "synergy", feature: "synergyTotal", sign: 1, maxAbs: 2.5 },
  { weight: "theme", feature: "themeCount", sign: 1, maxAbs: 3.0 },
  { weight: "tribe", feature: "tribeCount", sign: 1, maxAbs: 3.0 },
  { weight: "keyword", feature: "keywordCount", sign: 1, maxAbs: 2.0 },
  { weight: "embedSim", feature: "embedSimDelta", sign: 1, maxAbs: 14.0 },
  { weight: "roleNeed", feature: "roleNeed", sign: 1, maxAbs: 3.0 },
  { weight: "edhrecLift", feature: "edhrecLift", sign: 1, maxAbs: 4.0 },
  { weight: "edhrecInclusion", feature: "edhrecInclusion", sign: 1, maxAbs: 5.0 },
  { weight: "combo", feature: "comboCount", sign: 1, maxAbs: 3.0 },
  { weight: "quality", feature: "quality", sign: 1, maxAbs: 4.0 },
  { weight: "topHeavyPenalty", feature: "topHeavy", sign: -1, maxAbs: 2.0 },
  { weight: "saturatedSlotPenalty", feature: "saturatedSlot", sign: -1, maxAbs: 2.0 },
];

/** One number per trainable weight, worked out from the weight's name. */
function perKey(valueOf: (key: TrainableKey) => number): Record<TrainableKey, number> {
  return Object.fromEntries(
    TRAINABLE_KEYS.map(({ weight }) => [weight, valueOf(weight)]),
  ) as Record<TrainableKey, number>;
}

/**
 * Fits `RatingWeights` via L2-regularized, class-balanced logistic regression over
 * `ratingFeatureVector` samples, shrinking toward `initial` and preserving feature signs.
 */
export function fitLogisticWeights(
  samples: readonly CalibrationSample[],
  initial: RatingWeights,
  options: FitLogisticOptions = {},
): RatingWeights {
  if (samples.length === 0) return initial;
  const lr = options.learningRate ?? 0.15;
  const epochs = options.epochs ?? 120;
  const l2 = options.l2 ?? 0.02;

  let positives = 0;
  let negatives = 0;
  for (const s of samples) {
    if (s.label === 1) positives += 1;
    else negatives += 1;
  }
  const posWeight = positives > 0 ? samples.length / (2 * positives) : 1;
  const negWeight = negatives > 0 ? samples.length / (2 * negatives) : 1;

  const w = perKey((key) => initial[key]);

  for (let epoch = 0; epoch < epochs; epoch++) {
    const grad = perKey(() => 0);

    for (const sample of samples) {
      const f = sample.features;
      const synPart = Math.min(initial.synergyCap, w.synergy * f.synergyTotal);
      const logit =
        RATING_BIAS +
        synPart +
        w.theme * f.themeCount +
        w.tribe * f.tribeCount +
        w.keyword * f.keywordCount +
        w.embedSim * f.embedSimDelta +
        w.roleNeed * f.roleNeed +
        w.edhrecLift * f.edhrecLift +
        w.edhrecInclusion * f.edhrecInclusion +
        w.combo * f.comboCount +
        w.quality * f.quality +
        w.topHeavyPenalty * f.topHeavy +
        w.saturatedSlotPenalty * f.saturatedSlot;
      const pred = sigmoid(logit);
      const err = (pred - sample.label) * (sample.label === 1 ? posWeight : negWeight);

      for (const spec of TRAINABLE_KEYS) {
        const value = f[spec.feature];
        if (value !== 0) grad[spec.weight] += err * value;
      }
    }

    for (const spec of TRAINABLE_KEYS) {
      const key = spec.weight;
      const step = grad[key] / samples.length + l2 * (w[key] - initial[key]);
      const updated = w[key] - lr * step;
      w[key] =
        spec.sign === 1
          ? Math.max(0, Math.min(spec.maxAbs, updated))
          : Math.min(0, Math.max(-spec.maxAbs, updated));
    }
  }

  return { ...initial, ...perKey((key) => Number(w[key].toFixed(3))) };
}
