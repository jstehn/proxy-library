// The pure code of decks/play that the other areas, the module root and the browser use (ADR 0016, 0029).
export {
  simulateCastOnCurve,
  type CardCastability,
  type CastabilitySummary,
} from "./domain/castability";
export {
  openingHandOdds,
  type LandDropOdds,
  type OddsRow,
  type OpeningHandOdds,
} from "./domain/draws";
export {
  simulateOpeningHands,
  type GoldfishReport,
  type SampleHand,
  type SimulateHandsOptions,
} from "./domain/goldfish";
export { dealHand, nextHand, type HandState, type TestHandEvent } from "./domain/opening-hand/hand";
export {
  EARLY_RAMP_MAX_MV,
  library,
  type DrawLine,
  type LibraryCard,
} from "./domain/opening-hand/library";
