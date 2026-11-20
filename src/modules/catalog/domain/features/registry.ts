import { entersTapped } from "./recognizers/enters-tapped";
import { helpsOpponents } from "./recognizers/helps-opponents";
import { landCycles } from "./recognizers/land-cycles";
import { bracketFlags } from "./recognizers/bracket-flags";
import { grants } from "./recognizers/grants";
import { faces, signalIO, signals } from "./recognizers/signals";
import { roleTags } from "./recognizers/role-tags";
import { tapMana } from "./recognizers/tap-mana";
import { leaderThemes, themes } from "./recognizers/themes";
import type { AnyRecognizer, CardFeatureFields, CardFeatures, CardText } from "./types";
import { FEATURES_VERSION } from "./version";

/** Every recognizer, in the order they run. P12 to P14 add theirs here. */
export const RECOGNIZERS: readonly AnyRecognizer[] = [
  tapMana, // P11
  roleTags, // P13
  themes, // P13
  leaderThemes, // P13
  bracketFlags, // P13
  signals, // P13
  signalIO, // P13
  faces, // P13
  grants, // P13
  entersTapped, // P14
  helpsOpponents, // P14
  landCycles, // P14
];

/** What a card does, worked out from its text. Pure: the same card always gives the same answer. */
export function extractFeatures(card: CardText): CardFeatures {
  const fields: Record<string, unknown> = {};
  for (const recognizer of RECOGNIZERS) fields[recognizer.field] = recognizer.recognize(card);
  return { featuresVersion: FEATURES_VERSION, ...(fields as CardFeatureFields) };
}
