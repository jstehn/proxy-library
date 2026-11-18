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

export type CostReducerScope = "blitz" | "creature_power_gte_4" | "commander" | "all_spells";

export interface CostReducer {
  cardName: string;
  scope: CostReducerScope;
  /** Generic mana reduction per cast (multiplied by commandCasts when perCommandCast is true). */
  genericReduction: number;
  perCommandCast?: boolean;
}

export interface KeyCardPin {
  cardName: string;
  reason: string;
}

export interface AvoidCard {
  cardName: string;
  reason: string;
}

export interface DeckProfile {
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

export const EMPTY_DECK_PROFILE: DeckProfile = {
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
 * 1. Explicit DeckProfile field
 * 2. EDHREC average for the commander
 * 3. Generic format default
 */
export function resolveDeckProfileTargets(
  profile: DeckProfile | null | undefined,
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

function matchesReducerScope(
  scope: CostReducerScope,
  card: {
    oracleText?: string;
    typeLine?: string;
    power?: string | number | null;
    isCommander?: boolean;
    isBlitz?: boolean;
  },
): boolean {
  switch (scope) {
    case "all_spells":
      return true;
    case "commander":
      return card.isCommander === true;
    case "creature_power_gte_4": {
      const isCreature = card.typeLine ? /\bCreature\b/i.test(card.typeLine) : true;
      const p = parsePower(card.power);
      return isCreature && p !== null && p >= 4;
    }
    case "blitz":
      return (
        card.isBlitz === true || (card.oracleText ? /\bblitz\b/i.test(card.oracleText) : false)
      );
  }
}

/**
 * Computes effective mana value after applying deck-profile cost reducers.
 * For `perCommandCast` reducers (e.g. Henzie), `commandCasts` defaults to 1 if omitted
 * so static castability heuristics reflect the commander being online once cast.
 */
export function effectiveManaValue(
  baseManaValue: number,
  card: {
    oracleText?: string;
    typeLine?: string;
    power?: string | number | null;
    isCommander?: boolean;
    isBlitz?: boolean;
  },
  profile: DeckProfile | null | undefined,
  commandCasts = 1,
): number {
  if (!profile || profile.costReducers.length === 0) return Math.max(0, baseManaValue);
  let reduction = 0;
  for (const reducer of profile.costReducers) {
    if (!matchesReducerScope(reducer.scope, card)) continue;
    const multiplier = reducer.perCommandCast ? Math.max(0, commandCasts) : 1;
    reduction += reducer.genericReduction * multiplier;
  }
  return Math.max(0, baseManaValue - reduction);
}

export function isKeyCard(
  cardName: string,
  profile: DeckProfile | null | undefined,
  entryPinned = false,
): boolean {
  if (entryPinned) return true;
  if (!profile) return false;
  const needle = cardName.trim().toLowerCase();
  return profile.keyCards.some((k) => k.cardName.trim().toLowerCase() === needle);
}

export function isAvoidCard(cardName: string, profile: DeckProfile | null | undefined): boolean {
  if (!profile) return false;
  const needle = cardName.trim().toLowerCase();
  return profile.avoid.some((a) => a.cardName.trim().toLowerCase() === needle);
}

/** One-paragraph summary of a DeckProfile for `get_deck`'s top-level response. */
export function summarizeDeckProfile(profile: DeckProfile | null | undefined): string | null {
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
  const block = `## ${heading}\n\n${body}`;
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
    return `${current}\n\n${block}`;
  }

  const before = lines.slice(0, startIdx);
  const after = lines.slice(endIdx);
  return [...before, block, ...after]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
