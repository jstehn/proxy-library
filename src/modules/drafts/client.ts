// The drafts module's browser-safe public API (ADR 0016): pure domain code for client components.
// Server code imports index.ts instead.
export {
  abilityOf,
  COLORS,
  creatureTypes,
  isConspiracyLine,
  isCreatureLine,
  type CardAbility,
  type CardRef,
  type DraftAbility,
  type Note,
} from "./domain/abilities";
