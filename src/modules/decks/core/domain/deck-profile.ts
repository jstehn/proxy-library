import { hasTypeWord, isCreature, type CardFacts } from "@/shared/mtg";
import { parseCost } from "./mana";

export const FIXED_CARD_ROLE_TAGS = [
  "ramp",
  "draw",
  "removal",
  "wipe",
  "protection",
  "wincon",
  "recursion",
  "combo",
  "land",
] as const;

export type FixedCardRoleTag = (typeof FIXED_CARD_ROLE_TAGS)[number];

export type RoleTargetKey = "ramp" | "draw" | "removal" | "wipe";

export const COST_REDUCER_SCOPES = [
  "all_spells",
  "creatures",
  "noncreature",
  "artifacts",
  "enchantments",
  "instants_sorceries",
  "commander",
  "creature_power_gte_4",
  "blitz",
  "colorless",
  "graveyard",
] as const;

export type CostReducerScope = (typeof COST_REDUCER_SCOPES)[number];

export type CostReducerCard = Partial<Pick<CardFacts, "typeLine" | "manaCost">> &
  Readonly<{
    power?: string | number | null;
    isCommander?: boolean;
    /** The card has the blitz keyword (Scryfall's list). */
    isBlitz?: boolean;
    fromZone?: string;
  }>;

export type ScopePredicate = (card: CostReducerCard) => boolean;

export interface CostReducer {
  cardName: string;
  scope: CostReducerScope;
  /** Generic mana reduction per cast (multiplied by commandCasts when perCommandCast is true). */
  genericReduction: number;
  perCommandCast?: boolean;
  /** Optional minimum base mana value required for this reducer to apply (e.g. 4 for Henzie). */
  minManaValue?: number;
  /** Optional minimum creature power required for this reducer to apply (e.g. 4 for Goreclaw). */
  minPower?: number;
}

export interface KeyCardPin {
  cardName: string;
  reason: string;
}

export interface AvoidCard {
  cardName: string;
  reason: string;
}

export interface DeckPlan {
  plan: string | null;
  landTarget: number | null;
  roleTargets: Partial<Record<RoleTargetKey, number>> | null;
  keyCards: KeyCardPin[];
  avoid: AvoidCard[];
  costReducers: CostReducer[];
  winCons: string[];
  declaredCombos: string[];
  mulligan: string | null;
  pilotNotes: string | null;
}

export const EMPTY_DECK_PROFILE: DeckPlan = {
  plan: null,
  landTarget: null,
  roleTargets: null,
  keyCards: [],
  avoid: [],
  costReducers: [],
  winCons: [],
  declaredCombos: [],
  mulligan: null,
  pilotNotes: null,
};

export const GENERIC_COMMANDER_DEFAULTS: {
  landTarget: number;
  roleTargets: Record<RoleTargetKey, number>;
} = {
  landTarget: 37,
  roleTargets: { ramp: 10, draw: 10, removal: 8, wipe: 3 },
};

export interface EdhrecProfileFallback {
  landTarget?: number | null;
  roleTargets?: Partial<Record<RoleTargetKey, number>> | null;
}

/**
 * Resolves land and role targets using the 3-step fallback chain:
 * 1. Explicit DeckPlan field
 * 2. EDHREC average for the commander
 * 3. Generic format default
 */
export function resolveDeckProfileTargets(
  profile: DeckPlan | null | undefined,
  edhrec?: EdhrecProfileFallback | null,
  generic = GENERIC_COMMANDER_DEFAULTS,
): { landTarget: number; roleTargets: Record<RoleTargetKey, number> } {
  const landTarget = profile?.landTarget ?? edhrec?.landTarget ?? generic.landTarget;
  const roleTargets: Record<RoleTargetKey, number> = {
    ramp: profile?.roleTargets?.ramp ?? edhrec?.roleTargets?.ramp ?? generic.roleTargets.ramp,
    draw: profile?.roleTargets?.draw ?? edhrec?.roleTargets?.draw ?? generic.roleTargets.draw,
    removal:
      profile?.roleTargets?.removal ?? edhrec?.roleTargets?.removal ?? generic.roleTargets.removal,
    wipe: profile?.roleTargets?.wipe ?? edhrec?.roleTargets?.wipe ?? generic.roleTargets.wipe,
  };
  return { landTarget, roleTargets };
}

function parsePower(power: string | number | null | undefined): number | null {
  if (typeof power === "number" && Number.isFinite(power)) return power;
  if (typeof power === "string") {
    const n = Number(power);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export const DEFAULT_SCOPE_PREDICATES: Readonly<Record<CostReducerScope, ScopePredicate>> = {
  all_spells: () => true,
  creatures: (card) => (card.typeLine ? isCreature(card.typeLine) : false),
  noncreature: (card) => (card.typeLine ? !isCreature(card.typeLine) : false),
  artifacts: (card) => (card.typeLine ? hasTypeWord(card.typeLine, ["Artifact"]) : false),
  enchantments: (card) => (card.typeLine ? hasTypeWord(card.typeLine, ["Enchantment"]) : false),
  instants_sorceries: (card) =>
    card.typeLine ? hasTypeWord(card.typeLine, ["Instant", "Sorcery"]) : false,
  commander: (card) => card.isCommander === true,
  creature_power_gte_4: (card) => {
    const creature = card.typeLine ? isCreature(card.typeLine) : true;
    const p = parsePower(card.power);
    return creature && p !== null && p >= 4;
  },
  blitz: (card) => card.isBlitz === true,
  colorless: (card) => (card.manaCost ? !/\{[WUBRG]\}/i.test(card.manaCost) : false),
  graveyard: (card) => card.fromZone === "graveyard",
};

function matchesReducer(
  reducer: CostReducer,
  baseManaValue: number,
  card: CostReducerCard,
  scopePredicates: Readonly<Record<string, ScopePredicate>> = DEFAULT_SCOPE_PREDICATES,
): boolean {
  const pred = scopePredicates[reducer.scope];
  if (!pred || !pred(card)) return false;
  if (reducer.minManaValue !== undefined && baseManaValue < reducer.minManaValue) return false;
  if (reducer.minPower !== undefined) {
    const p = parsePower(card.power);
    if (p === null || p < reducer.minPower) return false;
  }
  return true;
}

/**
 * Computes effective mana value after applying deck-profile cost reducers.
 * For `perCommandCast` reducers (e.g. Henzie), `commandCasts` defaults to 1 if omitted
 * so static castability heuristics reflect the commander being online once cast.
 */
export function effectiveManaValue(
  baseManaValue: number,
  card: CostReducerCard,
  profile: DeckPlan | null | undefined,
  commandCasts = 1,
  scopePredicates: Readonly<Record<string, ScopePredicate>> = DEFAULT_SCOPE_PREDICATES,
): number {
  const minPips = parseCost(card.manaCost).pips.length;
  if (!profile || profile.costReducers.length === 0) return Math.max(minPips, baseManaValue);
  let reduction = 0;
  for (const reducer of profile.costReducers) {
    if (!matchesReducer(reducer, baseManaValue, card, scopePredicates)) continue;
    const multiplier = reducer.perCommandCast ? Math.max(0, commandCasts) : 1;
    reduction += reducer.genericReduction * multiplier;
  }
  return Math.max(minPips, baseManaValue - reduction);
}

export function isKeyCard(
  cardName: string,
  profile: DeckPlan | null | undefined,
  entryPinned = false,
): boolean {
  if (entryPinned) return true;
  if (!profile) return false;
  const needle = cardName.trim().toLowerCase();
  return profile.keyCards.some((k) => k.cardName.trim().toLowerCase() === needle);
}

export function isAvoidCard(cardName: string, profile: DeckPlan | null | undefined): boolean {
  if (!profile) return false;
  const needle = cardName.trim().toLowerCase();
  return profile.avoid.some((a) => a.cardName.trim().toLowerCase() === needle);
}

/** One-paragraph summary of a DeckPlan for `get_deck`'s top-level response. */
export function summarizeDeckProfile(profile: DeckPlan | null | undefined): string | null {
  if (!profile) return null;
  const parts: string[] = [];
  if (profile.plan) parts.push(profile.plan);
  if (profile.winCons.length > 0) parts.push(`Win cons: ${profile.winCons.join("; ")}.`);
  if (profile.keyCards.length > 0) {
    parts.push(`Key cards (pinned): ${profile.keyCards.map((k) => k.cardName).join(", ")}.`);
  }
  if (profile.avoid.length > 0) {
    parts.push(`Avoid: ${profile.avoid.map((a) => a.cardName).join(", ")}.`);
  }
  if (profile.costReducers.length > 0) {
    parts.push(
      `Cost reducers: ${profile.costReducers
        .map(
          (r) =>
            `${r.cardName} (-${r.genericReduction} ${r.scope}${r.perCommandCast ? "/cast" : ""})`,
        )
        .join(", ")}.`,
    );
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * Patches a single `## <section>` heading in a Markdown primer without rewriting other sections.
 * If the section does not exist yet, appends it at the end.
 */
export function patchPrimerSection(
  existingPrimer: string | null | undefined,
  section: string,
  content: string,
): string {
  const heading = section.trim().replace(/^#+\s*/, "");
  const body = content.trim();
  // Empty content removes the section (and leaves the primer as it was if there's none).
  const block = body === "" ? "" : `## ${heading}\n\n${body}`;
  const current = (existingPrimer ?? "").trim();
  if (!current) return block;

  const lines = current.split(/\r?\n/);
  const headingRegex = /^##\s+(.+)$/;
  let startIdx = -1;
  let endIdx = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i]?.match(headingRegex);
    if (!match) continue;
    if (startIdx === -1) {
      if (match[1]?.trim().toLowerCase() === heading.toLowerCase()) {
        startIdx = i;
      }
    } else {
      endIdx = i;
      break;
    }
  }

  if (startIdx === -1) {
    return block === "" ? current : `${current}\n\n${block}`;
  }

  const before = lines.slice(0, startIdx);
  const after = lines.slice(endIdx);
  return [...before, block, ...(block !== "" && after.length > 0 ? [""] : []), ...after]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The deck profile's declared combo that names this combo, or null: one that mentions the
 * Commander Spellbook id, or every piece by name (case-insensitive), e.g. "Avacyn + Viscera Seer
 * + Zulaport Cutthroat: free sac loop".
 */
export function declaredComboFor(
  combo: Readonly<{ id: string; uses: readonly string[] }>,
  declaredCombos: readonly string[],
): string | null {
  const pieces = combo.uses.map((name) => name.toLowerCase());
  for (const declared of declaredCombos) {
    const text = declared.toLowerCase();
    if (combo.id !== "" && text.includes(combo.id.toLowerCase())) return declared;
    if (pieces.length > 0 && pieces.every((piece) => text.includes(piece))) return declared;
  }
  return null;
}

/**
 * Filters a deck profile's `costReducers` to only reducers whose `cardName` matches one of the
 * deck's commanders (e.g. for the cast simulator where 1-ofs in the 99 are not
 * guaranteed to be on the battlefield).
 */
export function commanderOnlyProfile(
  profile: DeckPlan | null | undefined,
  commanderNames: readonly string[],
): DeckPlan | undefined {
  if (!profile) return undefined;
  const reducers = profile.costReducers ?? [];
  if (reducers.length === 0) return profile;
  const cmdLower = commanderNames.map((n) => n.trim().toLowerCase()).filter(Boolean);
  const filtered = reducers.filter((r) => {
    const src = r.cardName.trim().toLowerCase();
    return (
      src !== "" &&
      cmdLower.some((c) => c === src || c.startsWith(`${src},`) || c.startsWith(`${src} `))
    );
  });
  return { ...profile, costReducers: filtered };
}

export type AvoidSplit<Item> = Readonly<{
  kept: Item[];
  /** Names of the avoid cards that were left out, once each. */
  avoided: string[];
}>;

/** The items whose card isn't on the profile's avoid list, and the names of those that were. */
export function withoutAvoidCards<Item>(
  items: readonly Item[],
  nameOf: (item: Item) => string,
  profile: DeckPlan | null | undefined,
): AvoidSplit<Item> {
  const kept: Item[] = [];
  const avoided = new Set<string>();
  for (const item of items) {
    const name = nameOf(item);
    if (isAvoidCard(name, profile)) avoided.add(name);
    else kept.push(item);
  }
  return { kept, avoided: [...avoided] };
}
