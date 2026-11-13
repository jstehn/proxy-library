// Browser-safe public API for the social module (ADR 0016): pure domain constants and types only.
export type { ViewerRelation } from "./domain/friendship";
export {
  MANA_COLORS,
  MAX_BIO_LENGTH,
  MAX_SHOWCASE_CARDS,
  VISIBILITIES,
  type SectionVisibility,
} from "./domain/profile";
