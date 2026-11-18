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
] as const;

export type CostReducerScope = (typeof COST_REDUCER_SCOPES)[number];

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
    case "creatures":
      return card.typeLine ? /\bCreature\b/i.test(card.typeLine) : false;
    case "noncreature":
      return card.typeLine ? !/\bCreature\b/i.test(card.typeLine) : false;
    case "artifacts":
      return card.typeLine ? /\bArtifact\b/i.test(card.typeLine) : false;
    case "enchantments":
      return card.typeLine ? /\bEnchantment\b/i.test(card.typeLine) : false;
    case "instants_sorceries":
      return card.typeLine ? /\b(?:Instant|Sorcery)\b/i.test(card.typeLine) : false;
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

function matchesReducer(
  reducer: CostReducer,
  baseManaValue: number,
  card: {
    oracleText?: string;
    typeLine?: string;
    power?: string | number | null;
    isCommander?: boolean;
    isBlitz?: boolean;
  },
): boolean {
  if (!matchesReducerScope(reducer.scope, card)) return false;
  if (reducer.minManaValue !== undefined && baseManaValue < reducer.minManaValue) return false;
  if (reducer.minPower !== undefined) {
    const p = parsePower(card.power);
    if (p === null || p < reducer.minPower) return false;
  }
  return true;
}

function countColoredPips(manaCost: string | null | undefined): number {
  if (!manaCost) return 0;
  let pips = 0;
  for (const match of manaCost.matchAll(/\{([^}]+)\}/g)) {
    const sym = match[1]?.toUpperCase() ?? "";
    if (!sym || /^\d+$/.test(sym) || sym === "X" || sym === "Y" || sym === "Z") continue;
    pips += 1;
  }
  return pips;
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
    manaCost?: string | null;
    power?: string | number | null;
    isCommander?: boolean;
    isBlitz?: boolean;
  },
  profile: DeckProfile | null | undefined,
  commandCasts = 1,
): number {
  const minPips = countColoredPips(card.manaCost);
  if (!profile || profile.costReducers.length === 0) return Math.max(minPips, baseManaValue);
  let reduction = 0;
  for (const reducer of profile.costReducers) {
    if (!matchesReducer(reducer, baseManaValue, card)) continue;
    const multiplier = reducer.perCommandCast ? Math.max(0, commandCasts) : 1;
    reduction += reducer.genericReduction * multiplier;
  }
  return Math.max(minPips, baseManaValue - reduction);
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

/** The primer's "## Section" headings in order, so a tool can patch one by name. */
export function primerSections(primer: string | null | undefined): string[] {
  return [...(primer ?? "").matchAll(/^##\s+(.+)$/gm)].map((match) => (match[1] ?? "").trim());
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
 * deck's commanders (e.g. for opening-hand `mustCastBy` checks where 1-ofs in the 99 are not
 * guaranteed to be on the battlefield).
 */
export function commanderOnlyProfile(
  profile: DeckProfile | null | undefined,
  commanderNames: readonly string[],
): DeckProfile | undefined {
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
