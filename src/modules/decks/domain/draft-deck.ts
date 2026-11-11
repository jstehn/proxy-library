import { cardTags, type Tag, type Theme } from "@/shared/card-search";
import { isPlayed } from "./boards";
import type { Format } from "./deck";
import { landTarget, planManaBase, type LandCandidate, type ManaBasePlan } from "./mana-base";
import { deckSize, deckStats, isLand, roleTargets, TARGETED_TAGS, type TargetedTag } from "./stats";
import {
  deckProfile,
  scoreForDeck,
  scoreForRole,
  strength,
  WEIGHTS,
  type CandidateCard,
  type DeckProfile,
  type ProfileLine,
  type Reason,
  type RoleGap,
} from "./suggest";

// Draft a 100-card Commander deck from owned cards first, then optional store gap-fill, plus lands
// from planManaBase (design doc 37). Pure: queries load candidates, this picks and explains why.

export type DraftSection = "role" | "plan" | "curve";

export type CurveBucket = "1-2" | "3" | "4" | "5+";

export type DraftReason = Reason | Readonly<{ kind: "curve"; bucket: CurveBucket }>;

export type DraftCandidate = CandidateCard &
  Readonly<{
    manaCost: string | null;
    text: string;
    producedMana: readonly string[];
    ownedCopies: number;
    alsoIn: readonly string[];
  }>;

export type DraftOptions = Readonly<{
  /** Extra themes to seed into the deck profile (e.g. ["tokens", "aristocrats"]). */
  themes?: readonly Theme[];
  /** Override default Commander role targets (ramp 10, draw 10, removal 8, wipe 3). */
  roleTargets?: Partial<Record<TargetedTag, number>>;
  /**
   * Whether store cards can fill slots that owned cards cannot:
   * - "fill-gaps" (default): use owned cards first; use store cards for unmet role targets or empty spell slots
   * - "none": use only owned cards (plus basic lands)
   */
  includeStore?: "fill-gaps" | "none";
}>;

export type DraftedSpell = Readonly<{
  oracleId: string;
  name: string;
  manaCost: string | null;
  manaValue: number;
  typeLine: string;
  pool: "owned" | "store";
  section: DraftSection;
  primaryRole?: TargetedTag;
  score: number;
  reasons: readonly DraftReason[];
  priceCents: number | null;
  alsoIn: readonly string[];
}>;

export type RoleProgress = Readonly<{
  tag: TargetedTag;
  target: number;
  existing: number;
  ownedAdded: number;
  storeAdded: number;
  total: number;
}>;

export type DraftInput = Readonly<{
  format: Format;
  lines: readonly ProfileLine[];
  inDeck: ReadonlyMap<string, number>;
  candidates: readonly DraftCandidate[];
  ownedLands: readonly LandCandidate[];
  basics: readonly LandCandidate[];
  storeLands: readonly LandCandidate[];
  options?: DraftOptions;
}>;

export type DeckDraft = Readonly<{
  existingCount: number;
  targetTotal: number;
  profile: Readonly<{
    themes: readonly Theme[];
    tribes: readonly string[];
    keywords: readonly string[];
  }>;
  roleSummary: readonly RoleProgress[];
  spells: readonly DraftedSpell[];
  manaBase: ManaBasePlan;
  ownedAddedCount: number;
  storeAddedCount: number;
  storeCostCents: number;
  totalAfterDraft: number;
}>;

type DraftEntry = Readonly<{
  spell: DraftedSpell;
  candidate: DraftCandidate;
  line: ProfileLine;
}>;

const DEFAULT_ROLE_TARGETS: Readonly<Record<TargetedTag, number>> = {
  ramp: 10,
  draw: 10,
  removal: 8,
  wipe: 3,
};

/** Ideal proportions of non-land spells across mana value buckets when smoothing the curve. */
const CURVE_BUCKET_SHARES: Readonly<Record<CurveBucket, number>> = {
  "1-2": 0.35,
  "3": 0.28,
  "4": 0.2,
  "5+": 0.17,
};

const STORE_PRICE_FLOOR_CENTS = 25;

export function curveBucket(manaValue: number): CurveBucket {
  if (manaValue <= 2) return "1-2";
  if (manaValue === 3) return "3";
  if (manaValue === 4) return "4";
  return "5+";
}

function toProfileLine(candidate: DraftCandidate): ProfileLine {
  return {
    quantity: 1,
    manaValue: candidate.manaValue,
    manaCost: candidate.manaCost,
    typeLine: candidate.typeLine,
    board: "main",
    producedMana: candidate.producedMana,
    priceCents: candidate.priceCents,
    text: candidate.text,
    keywords: candidate.keywords,
  };
}

function effectiveStorePrice(priceCents: number | null): number {
  if (priceCents === null || priceCents <= 0) return STORE_PRICE_FLOOR_CENTS;
  return Math.max(STORE_PRICE_FLOOR_CENTS, priceCents);
}

function mergeThemes(base: readonly Theme[], extra: readonly Theme[] | undefined): Theme[] {
  if (!extra || extra.length === 0) return [...base];
  return [...new Set([...base, ...extra])];
}

function buildGaps(
  counts: Readonly<Record<TargetedTag, number>>,
  targets: Readonly<Record<TargetedTag, number>>,
): RoleGap[] {
  return TARGETED_TAGS.filter((tag) => counts[tag] < targets[tag]).map((tag) => ({
    tag,
    count: counts[tag],
    target: targets[tag],
  }));
}

function capManaBaseAdditions(manaBase: ManaBasePlan, maxLandsToAdd: number): ManaBasePlan {
  const budget = Math.max(0, maxLandsToAdd);
  let remaining = budget;
  const trimmedAdd = [];
  for (const entry of manaBase.add) {
    if (remaining <= 0) break;
    const quantity = Math.min(entry.quantity, remaining);
    trimmedAdd.push(quantity === entry.quantity ? entry : { ...entry, quantity });
    remaining -= quantity;
  }
  return { ...manaBase, add: trimmedAdd };
}

function compareOwnedFit(
  left: { score: number; card: DraftCandidate },
  right: { score: number; card: DraftCandidate },
): number {
  return (
    right.score - left.score ||
    strength(right.card) - strength(left.card) ||
    left.card.name.localeCompare(right.card.name) ||
    left.card.oracleId.localeCompare(right.card.oracleId)
  );
}

/**
 * Store picks prefer higher fit points first, then lower price among cards of equal fit, then
 * card strength, then name.
 */
function compareStoreFit(
  left: { points: number; score: number; card: DraftCandidate },
  right: { points: number; score: number; card: DraftCandidate },
): number {
  return (
    right.points - left.points ||
    effectiveStorePrice(left.card.priceCents) - effectiveStorePrice(right.card.priceCents) ||
    strength(right.card) - strength(left.card) ||
    left.card.name.localeCompare(right.card.name) ||
    left.card.oracleId.localeCompare(right.card.oracleId)
  );
}

/**
 * Pick the next card to smooth the mana curve: favors buckets furthest below CURVE_BUCKET_SHARES.
 */
function pickCurveCandidate(
  pool: readonly DraftCandidate[],
  chosenIds: ReadonlySet<string>,
  bucketCounts: Readonly<Record<CurveBucket, number>>,
  totalSpells: number,
  preferCheaperPrice: boolean,
): { candidate: DraftCandidate; bucket: CurveBucket; score: number } | null {
  let best: { candidate: DraftCandidate; bucket: CurveBucket; score: number } | null = null;
  const denominator = Math.max(1, totalSpells);

  for (const candidate of pool) {
    if (chosenIds.has(candidate.oracleId)) continue;
    const bucket = curveBucket(candidate.manaValue);
    const currentShare = bucketCounts[bucket] / denominator;
    const deficit = CURVE_BUCKET_SHARES[bucket] - currentShare;
    const cardStrength = strength(candidate);
    const score = deficit * 2 + cardStrength;

    if (best === null) {
      best = { candidate, bucket, score };
      continue;
    }

    const bucketDeficitDiff =
      CURVE_BUCKET_SHARES[bucket] -
      bucketCounts[bucket] / denominator -
      (CURVE_BUCKET_SHARES[best.bucket] - bucketCounts[best.bucket] / denominator);

    if (preferCheaperPrice && Math.abs(bucketDeficitDiff) < 0.05) {
      const priceDiff =
        effectiveStorePrice(candidate.priceCents) - effectiveStorePrice(best.candidate.priceCents);
      if (priceDiff !== 0) {
        if (priceDiff < 0) best = { candidate, bucket, score };
        continue;
      }
    }

    if (
      score > best.score ||
      (score === best.score &&
        (cardStrength > strength(best.candidate) ||
          (cardStrength === strength(best.candidate) &&
            (candidate.name.localeCompare(best.candidate.name) < 0 ||
              (candidate.name === best.candidate.name &&
                candidate.oracleId.localeCompare(best.candidate.oracleId) < 0)))))
    ) {
      best = { candidate, bucket, score };
    }
  }

  return best;
}

/**
 * Draft a full deck up to the format's target size (100 in Commander), prioritizing owned role
 * cards, owned on-plan cards, owned curve-smoothing cards, and (when enabled) store cards for
 * remaining gaps, then delegating the land slots to `planManaBase`.
 */
export function draftDeck(input: DraftInput): DeckDraft {
  const includeStore = input.options?.includeStore ?? "fill-gaps";
  const targetTotal = deckSize(input.format).cards;
  const playedLines = input.lines.filter((line) => isPlayed(line.board));
  const initialStats = deckStats(playedLines);
  const existingCount = initialStats.cardCount;
  const existingLands = initialStats.lands;

  const baseTargets = roleTargets(input.format) ?? DEFAULT_ROLE_TARGETS;
  const targets: Record<TargetedTag, number> = {
    ramp: Math.max(0, input.options?.roleTargets?.ramp ?? baseTargets.ramp),
    draw: Math.max(0, input.options?.roleTargets?.draw ?? baseTargets.draw),
    removal: Math.max(0, input.options?.roleTargets?.removal ?? baseTargets.removal),
    wipe: Math.max(0, input.options?.roleTargets?.wipe ?? baseTargets.wipe),
  };

  const initialProfile = deckProfile(playedLines, input.format);
  const seedThemes = mergeThemes(initialProfile.themes, input.options?.themes);

  // Deduplicate and normalize candidates deterministically so input order never changes output.
  const seenCandidateIds = new Set<string>();
  const uniqueCandidates = [...input.candidates]
    .filter((candidate) => {
      if ((input.inDeck.get(candidate.oracleId) ?? 0) > 0) return false;
      if (isLand(candidate.typeLine)) return false;
      return true;
    })
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name) ||
        a.oracleId.localeCompare(b.oracleId) ||
        b.ownedCopies - a.ownedCopies ||
        (a.priceCents ?? 0) - (b.priceCents ?? 0),
    )
    .filter((candidate) => {
      if (seenCandidateIds.has(candidate.oracleId)) return false;
      seenCandidateIds.add(candidate.oracleId);
      return true;
    });

  const ownedPool: DraftCandidate[] = uniqueCandidates
    .filter((candidate) => candidate.ownedCopies > 0 && candidate.pool === "owned")
    .map((candidate) => ({ ...candidate, pool: "owned" }));
  const storePool: DraftCandidate[] = uniqueCandidates
    .filter((candidate) => candidate.ownedCopies === 0 || candidate.pool === "store")
    .map((candidate) => ({ ...candidate, pool: "store" }));

  const existingRoles: Record<TargetedTag, number> = {
    ramp: initialStats.tags.ramp,
    draw: initialStats.tags.draw,
    removal: initialStats.tags.removal,
    wipe: initialStats.tags.wipe,
  };

  if (existingCount >= targetTotal) {
    const rawManaBase = planManaBase({
      format: input.format,
      lines: playedLines,
      inDeck: input.inDeck,
      owned: input.ownedLands,
      basics: input.basics,
      store: input.storeLands,
      deckRoles: initialProfile.gaps.map((gap) => gap.tag),
      deckThemes: seedThemes,
    });
    const cappedManaBase: ManaBasePlan = { ...rawManaBase, add: [] };
    return {
      existingCount,
      targetTotal,
      profile: {
        themes: seedThemes,
        tribes: initialProfile.tribes,
        keywords: initialProfile.keywords,
      },
      roleSummary: TARGETED_TAGS.map((tag) => ({
        tag,
        target: targets[tag],
        existing: existingRoles[tag],
        ownedAdded: 0,
        storeAdded: 0,
        total: existingRoles[tag],
      })),
      spells: [],
      manaBase: cappedManaBase,
      ownedAddedCount: 0,
      storeAddedCount: 0,
      storeCostCents: 0,
      totalAfterDraft: existingCount,
    };
  }

  const maxNewSpells = targetTotal - existingCount;
  const drafted: DraftEntry[] = [];
  const chosenIds = new Set<string>();
  const roleCounts: Record<TargetedTag, number> = { ...existingRoles };
  const bucketCounts: Record<CurveBucket, number> = {
    "1-2": 0,
    "3": 0,
    "4": 0,
    "5+": 0,
  };
  let totalSpellsCount = 0;

  for (const line of playedLines) {
    if (isLand(line.typeLine)) continue;
    bucketCounts[curveBucket(line.manaValue)] += line.quantity;
    totalSpellsCount += line.quantity;
  }

  const recordPick = (
    candidate: DraftCandidate,
    section: DraftSection,
    score: number,
    reasons: readonly DraftReason[],
    primaryRole?: TargetedTag,
  ) => {
    const line = toProfileLine(candidate);
    const spell: DraftedSpell = {
      oracleId: candidate.oracleId,
      name: candidate.name,
      manaCost: candidate.manaCost,
      manaValue: candidate.manaValue,
      typeLine: candidate.typeLine,
      pool: candidate.pool,
      section,
      ...(primaryRole !== undefined ? { primaryRole } : {}),
      score,
      reasons,
      priceCents: candidate.priceCents,
      alsoIn: candidate.alsoIn,
    };
    drafted.push({ spell, candidate, line });
    chosenIds.add(candidate.oracleId);
    bucketCounts[curveBucket(candidate.manaValue)] += 1;
    totalSpellsCount += 1;
    for (const tag of TARGETED_TAGS) {
      if (candidate.roles.includes(tag)) {
        roleCounts[tag] += 1;
      }
    }
  };

  const currentProfile = (): DeckProfile => {
    const currentLines = [...playedLines, ...drafted.map((entry) => entry.line)];
    const computed = deckProfile(currentLines, input.format);
    return {
      themes: mergeThemes(computed.themes, seedThemes),
      tribes: computed.tribes,
      gaps: buildGaps(roleCounts, targets),
      keywords: computed.keywords,
    };
  };

  // Step A: Fill role gaps from ownedPool first.
  const openGapCount = (candidate: DraftCandidate): number =>
    TARGETED_TAGS.filter((tag) => roleCounts[tag] < targets[tag] && candidate.roles.includes(tag))
      .length;

  const exhaustedOwnedRoles = new Set<TargetedTag>();
  while (drafted.length < maxNewSpells) {
    const activeRoles = TARGETED_TAGS.filter(
      (tag) => roleCounts[tag] < targets[tag] && !exhaustedOwnedRoles.has(tag),
    );
    if (activeRoles.length === 0) break;

    activeRoles.sort(
      (left, right) => targets[right] - roleCounts[right] - (targets[left] - roleCounts[left]),
    );
    const targetRole = activeRoles[0];
    const profileSnapshot = currentProfile();

    const matches = ownedPool
      .filter((candidate) => !chosenIds.has(candidate.oracleId))
      .flatMap((candidate) => {
        const scored = scoreForRole(candidate, targetRole, profileSnapshot);
        return scored === null
          ? []
          : [
              {
                card: candidate,
                score: scored.score + openGapCount(candidate) * 0.1,
                reasons: scored.reasons,
              },
            ];
      })
      .sort(compareOwnedFit);

    if (matches.length === 0) {
      exhaustedOwnedRoles.add(targetRole);
      continue;
    }

    const best = matches[0];
    recordPick(best.card, "role", best.score, best.reasons, targetRole);
  }

  // Step B: Fill remaining role gaps from storePool when allowed.
  if (includeStore !== "none") {
    const exhaustedStoreRoles = new Set<TargetedTag>();
    while (drafted.length < maxNewSpells) {
      const activeRoles = TARGETED_TAGS.filter(
        (tag) => roleCounts[tag] < targets[tag] && !exhaustedStoreRoles.has(tag),
      );
      if (activeRoles.length === 0) break;

      activeRoles.sort(
        (left, right) => targets[right] - roleCounts[right] - (targets[left] - roleCounts[left]),
      );
      const targetRole = activeRoles[0];
      const profileSnapshot = currentProfile();

      const matches = storePool
        .filter((candidate) => !chosenIds.has(candidate.oracleId))
        .flatMap((candidate) => {
          const scored = scoreForRole(candidate, targetRole, profileSnapshot);
          if (scored === null) return [];
          const points = Math.round(scored.score - WEIGHTS.strength * strength(candidate));
          return [
            {
              card: candidate,
              points,
              score: scored.score,
              reasons: scored.reasons,
            },
          ];
        })
        .sort(compareStoreFit);

      if (matches.length === 0) {
        exhaustedStoreRoles.add(targetRole);
        continue;
      }

      const best = matches[0];
      recordPick(best.card, "role", best.score, best.reasons, targetRole);
    }
  }

  // Step C: Owned on-plan spells (themes, tribes, commander keywords).
  if (drafted.length < maxNewSpells) {
    const planProfile: DeckProfile = { ...currentProfile(), gaps: [] };
    const planMatches = ownedPool
      .filter((candidate) => !chosenIds.has(candidate.oracleId))
      .flatMap((candidate) => {
        const scored = scoreForDeck(candidate, planProfile);
        return scored === null
          ? []
          : [{ card: candidate, score: scored.score, reasons: scored.reasons }];
      })
      .sort(compareOwnedFit);

    for (const match of planMatches) {
      if (drafted.length >= maxNewSpells) break;
      recordPick(match.card, "plan", match.score, match.reasons);
    }
  }

  // Step D: Owned curve-smoothing playable spells.
  while (drafted.length < maxNewSpells) {
    const pick = pickCurveCandidate(ownedPool, chosenIds, bucketCounts, totalSpellsCount, false);
    if (pick === null) break;
    recordPick(pick.candidate, "curve", pick.score, [{ kind: "curve", bucket: pick.bucket }]);
  }

  // Step E: Store on-plan and curve fallback when ownedPool is exhausted and store is allowed.
  if (includeStore !== "none" && drafted.length < maxNewSpells) {
    const planProfile: DeckProfile = { ...currentProfile(), gaps: [] };
    const storePlanMatches = storePool
      .filter((candidate) => !chosenIds.has(candidate.oracleId))
      .flatMap((candidate) => {
        const scored = scoreForDeck(candidate, planProfile);
        if (scored === null) return [];
        const points = Math.round(scored.score - WEIGHTS.strength * strength(candidate));
        return [
          {
            card: candidate,
            points,
            score: scored.score,
            reasons: scored.reasons,
          },
        ];
      })
      .sort(compareStoreFit);

    for (const match of storePlanMatches) {
      if (drafted.length >= maxNewSpells) break;
      recordPick(match.card, "plan", match.score, match.reasons);
    }

    while (drafted.length < maxNewSpells) {
      const pick = pickCurveCandidate(storePool, chosenIds, bucketCounts, totalSpellsCount, true);
      if (pick === null) break;
      recordPick(pick.candidate, "curve", pick.score, [{ kind: "curve", bucket: pick.bucket }]);
    }
  }

  // Reconcile spell count with planManaBase so commanders + spells + lands = targetTotal (100).
  const availableOwnedNonBasics = input.ownedLands.filter(
    (land) =>
      !land.isBasicLand && land.ownedCopies > 0 && (input.inDeck.get(land.oracleId) ?? 0) === 0,
  ).length;
  const maxAddableLands = input.basics.length > 0 ? maxNewSpells : availableOwnedNonBasics;

  const landsAddedForPrefix = (prefixLength: number): number => {
    const trialLines = [
      ...playedLines,
      ...drafted.slice(0, prefixLength).map((entry) => entry.line),
    ];
    const desiredLands = landTarget(input.format, deckStats(trialLines)).lands;
    const deficit = Math.max(0, desiredLands - existingLands);
    return Math.min(deficit, maxAddableLands);
  };

  let keptSpellCount = Math.min(
    drafted.length,
    Math.max(0, maxNewSpells - landsAddedForPrefix(Math.min(drafted.length, 62))),
  );
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const landsToAdd = landsAddedForPrefix(keptSpellCount);
    keptSpellCount = Math.min(drafted.length, Math.max(0, maxNewSpells - landsToAdd));
  }

  let keptEntries = drafted.slice(0, keptSpellCount);
  const combinedLines = [...playedLines, ...keptEntries.map((entry) => entry.line)];
  const combinedInDeck = new Map(input.inDeck);
  for (const entry of keptEntries) {
    combinedInDeck.set(entry.spell.oracleId, 1);
  }

  const finalProfile = deckProfile(combinedLines, input.format);
  const finalThemes = mergeThemes(finalProfile.themes, seedThemes);

  const rawManaBase = planManaBase({
    format: input.format,
    lines: combinedLines,
    inDeck: combinedInDeck,
    owned: input.ownedLands,
    basics: input.basics,
    store: input.storeLands,
    deckRoles: finalProfile.gaps.map((gap) => gap.tag),
    deckThemes: finalThemes,
  });

  const manaBase = capManaBaseAdditions(rawManaBase, maxNewSpells);
  const plannedLandAdditions = manaBase.add.reduce((sum, addition) => sum + addition.quantity, 0);

  // If a curve threshold boundary caused keptEntries.length + plannedLandAdditions to differ by 1
  // from maxNewSpells while we have enough drafted spells, align keptEntries to hit targetTotal.
  const exactSpellTarget = Math.max(0, maxNewSpells - plannedLandAdditions);
  if (keptEntries.length !== exactSpellTarget && drafted.length >= exactSpellTarget) {
    keptEntries = drafted.slice(0, exactSpellTarget);
  } else if (existingCount + keptEntries.length + plannedLandAdditions > targetTotal) {
    keptEntries = drafted.slice(0, exactSpellTarget);
  }

  const spells = keptEntries.map((entry) => entry.spell);
  const ownedAddedByRole: Record<TargetedTag, number> = {
    ramp: 0,
    draw: 0,
    removal: 0,
    wipe: 0,
  };
  const storeAddedByRole: Record<TargetedTag, number> = {
    ramp: 0,
    draw: 0,
    removal: 0,
    wipe: 0,
  };

  for (const entry of keptEntries) {
    const tags = new Set<Tag>([
      ...entry.candidate.roles,
      ...cardTags({
        typeLine: entry.candidate.typeLine,
        text: entry.candidate.text,
        producedMana: entry.candidate.producedMana,
      }),
    ]);
    for (const tag of TARGETED_TAGS) {
      if (!tags.has(tag)) continue;
      if (entry.spell.pool === "owned") {
        ownedAddedByRole[tag] += 1;
      } else {
        storeAddedByRole[tag] += 1;
      }
    }
  }

  const roleSummary: RoleProgress[] = TARGETED_TAGS.map((tag) => {
    const existing = existingRoles[tag];
    const ownedAdded = ownedAddedByRole[tag];
    const storeAdded = storeAddedByRole[tag];
    return {
      tag,
      target: targets[tag],
      existing,
      ownedAdded,
      storeAdded,
      total: existing + ownedAdded + storeAdded,
    };
  });

  const ownedSpellCount = spells.filter((spell) => spell.pool === "owned").length;
  const storeSpells = spells.filter((spell) => spell.pool === "store");
  const storeAddedCount = storeSpells.length;
  const storeCostCents = storeSpells.reduce((sum, spell) => sum + (spell.priceCents ?? 0), 0);
  const ownedAddedCount = ownedSpellCount + plannedLandAdditions;
  const totalAfterDraft = existingCount + spells.length + plannedLandAdditions;

  return {
    existingCount,
    targetTotal,
    profile: {
      themes: finalThemes,
      tribes: finalProfile.tribes,
      keywords: finalProfile.keywords,
    },
    roleSummary,
    spells,
    manaBase,
    ownedAddedCount,
    storeAddedCount,
    storeCostCents,
    totalAfterDraft,
  };
}
