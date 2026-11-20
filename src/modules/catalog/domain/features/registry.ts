import { entersTapped } from "./recognizers/enters-tapped";
import { helpsOpponents } from "./recognizers/helps-opponents";
import { tapMana } from "./recognizers/tap-mana";
import type { AnyRecognizer, CardFeatureFields, CardFeatures, CardText } from "./types";
import { FEATURES_VERSION } from "./version";

/** Every recognizer, in the order they run. P12 to P14 add theirs here. */
export const RECOGNIZERS: readonly AnyRecognizer[] = [tapMana, entersTapped, helpsOpponents];

/** What a card does, worked out from its text. Pure: the same card always gives the same answer. */
export function extractFeatures(card: CardText): CardFeatures {
  const fields: Record<string, unknown> = {};
  for (const recognizer of RECOGNIZERS) fields[recognizer.field] = recognizer.recognize(card);
  return { featuresVersion: FEATURES_VERSION, ...(fields as CardFeatureFields) };
}
