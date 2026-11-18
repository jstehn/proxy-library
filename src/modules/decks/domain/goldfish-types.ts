import type { Tag } from "@/shared/card-search";
import type { Board } from "./deck";
import type { ManaPool } from "./mana";

export type GoldfishZone =
  "library" | "hand" | "battlefield" | "graveyard" | "exile" | "commandZone";

export type GoldfishDeckLine = Readonly<{
  oracleId: string;
  name: string;
  printingId: string;
  board: Board;
  quantity: number;
  typeLine: string;
  manaCost?: string | null;
  manaValue?: number;
  text?: string;
  producedMana?: readonly string[];
}>;

export type GoldfishCard = Readonly<{
  key: string;
  oracleId: string;
  name: string;
  printingId: string;
  typeLine: string;
  manaCost?: string | null;
  manaValue?: number;
  text?: string;
  producedMana?: readonly string[];
  isLand: boolean;
  isCommander: boolean;
  isToken?: boolean;
  tags: readonly Tag[];
}>;

export type BattlefieldPermanent = Readonly<{
  card: GoldfishCard;
  tapped: boolean;
  enteredTurn: number;
  /** Generic runtime abilities (e.g. "haste", "blitzed", "attacking") — foundation for Layer 6 grants. */
  abilities?: readonly string[];
  /** Generic counter map (e.g. { "+1/+1": 1, "-1/-1": 1 }) — foundation for SBAs & Undying/Persist. */
  counters?: Readonly<Record<string, number>>;
  /** Temporary end-of-turn stat/ability modifiers (cleared on end_step). */
  tempModifiers?: ReadonlyArray<Readonly<{ kind: "pt"; power: number; toughness: number }>>;
  /** Key of the battlefield permanent this Aura/Equipment is attached to (CR 301.5 / 303.4). */
  attachedTo?: string;
  /** Convenience flags kept in sync with `abilities` for existing callers. */
  haste?: boolean;
  blitzed?: boolean;
}>;

export type EndStepTrigger = Readonly<{
  key: string;
  kind: "sacrifice_blitz" | "return_to_battlefield" | "custom";
  effectId?: string;
  /** Turn whose end step should fire this trigger (CR 513.1a: triggers created during end_step wait until turn + 1). */
  dueTurn?: number;
}>;

export type GoldfishPhase = "main" | "combat" | "end_step";

export type GoldfishState = Readonly<{
  format: string;
  onTheDraw: boolean;
  freeMulligan: boolean;
  kept: boolean;
  turn: number;
  phase?: GoldfishPhase;
  mulligans: number;
  toBottom: number;
  landsPlayedThisTurn: number;
  commandCasts: number;
  /** Per-commander cast count for Partner/Background tax (CR 903.8). */
  commandCastsByKey?: Readonly<Record<string, number>>;
  /** Per-turn usage counters (e.g. Muldrotha permanent types, Storm count). */
  turnUsage?: Readonly<Record<string, number>>;
  spellsCastThisTurn?: number;
  manaPool: ManaPool;
  endStepQueue: readonly EndStepTrigger[];
  library: readonly GoldfishCard[];
  hand: readonly GoldfishCard[];
  battlefield: readonly BattlefieldPermanent[];
  graveyard: readonly GoldfishCard[];
  exile: readonly GoldfishCard[];
  commandZone: readonly GoldfishCard[];
  lastActionNote: string;
}>;
