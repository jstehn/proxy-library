import { type Theme } from "@/shared/card-search";
import { type CardFacts, type CardIdentity, curveSlot, manaCurve } from "@/shared/kernel";
import { isPlayed } from "./boards";
import type { Format } from "./deck";
import { landTarget, planManaBase, type LandCandidate, type ManaBasePlan } from "./mana-base";
import { FORMAT_RULES, formatRules } from "./format-rules";
import { deckStats, isLand, TARGETED_TAGS, type TargetedTag } from "./stats";
import {
  deckProfile,
  scoreForDeck,
  scoreForRole,
  strength,
  WEIGHTS,
  type CandidateCard,
  type DeckFingerprint,
  type ProfileLine,
  type Reason,
  type RoleGap,
} from "./suggest";

// Draft a deck (100-card Commander or 60-card Constructed with playsets) from owned cards first,
// then optional store gap-fill, plus lands from planManaBase (design docs 37 & 44). Pure: queries
// load candidates, this picks and explains why.

export type DraftSection = "role" | "plan" | "curve";

export type DraftReason = Reason | Readonly<{ kind: "curve"; slot: number }>;

export type DraftCandidate = CandidateCard &
  Readonly<{
    manaCost: string | null;
    text: string;
    producedMana: readonly string[];
    ownedCopies: number;
    alsoIn: readonly string[];
    /** True when the card is restricted to 1 copy in this format (e.g. Vintage). */
    isRestricted?: boolean;
  }>;

export type DraftOptions = Readonly<{
  /** Extra themes to seed into the deck profile (e.g. ["tokens", "aristocrats"]). */
  themes?: readonly Theme[];
  /** Override default format role targets (Commander 10/10/8/3; 60-card 4/6/6/2). */
  roleTargets?: Partial<Record<TargetedTag, number>>;
  /**
   * Whether store cards can fill slots that owned cards cannot:
   * - "fill-gaps" (default): use owned cards first; use store cards for unmet role targets or empty spell slots
   * - "none": use only owned cards (plus basic lands)
   */
  includeStore?: "fill-gaps" | "none";
}>;

export type DraftedSpell = Pick<CardIdentity, "oracleId"> &
  Pick<CardFacts, "name" | "manaCost" | "manaValue" | "typeLine"> &
  Readonly<{
    quantity: number;
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

/**
 * Ideal proportions of non-land spells in each slot of the mana curve (0 to 7+) when smoothing it.
 * They add up to 1.
 */
const CURVE_SLOT_SHARES: readonly number[] = [0.02, 0.13, 0.2, 0.28, 0.2, 0.1, 0.05, 0.02];

const STORE_PRICE_FLOOR_CENTS = 25;

const ANY_NUMBER_NAMED = /a deck can have any number of cards named/i;

function candidateCopyLimit(candidate: DraftCandidate, format: Format): number {
  if (ANY_NUMBER_NAMED.test(candidate.text)) return 99;
  const rules = formatRules(format);
  if (rules.plannedCopyLimit === 1 || candidate.isRestricted) return 1;
  return rules.buildsFromOwnedPool ? 99 : rules.plannedCopyLimit;
}

function toProfileLine(candidate: DraftCandidate, quantity = 1): ProfileLine {
  return {
    quantity,
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

function takeSpellCopies(entries: readonly DraftEntry[], maxCopies: number): DraftEntry[] {
  const limit = Math.max(0, maxCopies);
  const kept: DraftEntry[] = [];
  let remaining = limit;
  for (const entry of entries) {
    if (remaining <= 0) break;
    const take = Math.min(entry.spell.quantity, remaining);
    kept.push(
      take === entry.spell.quantity
        ? entry
        : {
            ...entry,
            spell: { ...entry.spell, quantity: take },
            line: { ...entry.line, quantity: take },
          },
    );
    remaining -= take;
  }
  return kept;
}

function totalSpellCopies(entries: readonly DraftEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.spell.quantity, 0);
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
 * Pick the next card to smooth the mana curve: favors slots furthest below CURVE_SLOT_SHARES.
 */
function pickCurveCandidate(
  pool: readonly DraftCandidate[],
  hasRoom: (candidate: DraftCandidate) => boolean,
  slotCounts: readonly number[],
  totalSpells: number,
  preferCheaperPrice: boolean,
): { candidate: DraftCandidate; slot: number; score: number } | null {
  let best: { candidate: DraftCandidate; slot: number; score: number } | null = null;
  const denominator = Math.max(1, totalSpells);

  for (const candidate of pool) {
    if (!hasRoom(candidate)) continue;
    const slot = curveSlot(candidate.manaValue);
    const currentShare = slotCounts[slot] / denominator;
    const deficit = CURVE_SLOT_SHARES[slot] - currentShare;
    const cardStrength = strength(candidate);
    const score = deficit * 2 + cardStrength;

    if (best === null) {
      best = { candidate, slot, score };
      continue;
    }

    const slotDeficitDiff =
      CURVE_SLOT_SHARES[slot] -
      slotCounts[slot] / denominator -
      (CURVE_SLOT_SHARES[best.slot] - slotCounts[best.slot] / denominator);

    if (preferCheaperPrice && Math.abs(slotDeficitDiff) < 0.05) {
      const priceDiff =
        effectiveStorePrice(candidate.priceCents) - effectiveStorePrice(best.candidate.priceCents);
      if (priceDiff !== 0) {
        if (priceDiff < 0) best = { candidate, slot, score };
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
      best = { candidate, slot, score };
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
  const targetTotal = formatRules(input.format).deckSize.cards;
  const playedLines = input.lines.filter((line) => isPlayed(line.board));
  const initialStats = deckStats(playedLines);
  const existingCount = initialStats.cardCount;
  const existingLands = initialStats.lands;

  const baseTargets = formatRules(input.format).roleTargets ?? FORMAT_RULES.commander.roleTargets;
  const targets: Record<TargetedTag, number> = {
    ramp: Math.max(0, input.options?.roleTargets?.ramp ?? baseTargets.ramp),
    draw: Math.max(0, input.options?.roleTargets?.draw ?? baseTargets.draw),
    removal: Math.max(0, input.options?.roleTargets?.removal ?? baseTargets.removal),
    wipe: Math.max(0, input.options?.roleTargets?.wipe ?? baseTargets.wipe),
  };

  const initialProfile = deckProfile(playedLines, input.format);
  const seedThemes = mergeThemes(initialProfile.themes, input.options?.themes);

  const remainingCopyRoom = (candidate: DraftCandidate, addedCount: number): number => {
    const already = input.inDeck.get(candidate.oracleId) ?? 0;
    const formatRoom = Math.max(
      0,
      candidateCopyLimit(candidate, input.format) - already - addedCount,
    );
    if (candidate.pool === "owned") {
      const ownedRoom = Math.max(0, candidate.ownedCopies - already - addedCount);
      return Math.min(formatRoom, ownedRoom);
    }
    return formatRoom;
  };

  // Deduplicate and normalize candidates deterministically so input order never changes output.
  const seenCandidateIds = new Set<string>();
  const uniqueCandidates = [...input.candidates]
    .filter((candidate) => {
      if (isLand(candidate.typeLine)) return false;
      const already = input.inDeck.get(candidate.oracleId) ?? 0;
      return candidateCopyLimit(candidate, input.format) > already;
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
    .filter(
      (candidate) =>
        candidate.pool === "owned" &&
        candidate.ownedCopies > (input.inDeck.get(candidate.oracleId) ?? 0),
    )
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
  let draftedCopiesCount = 0;
  const addedByOracle = new Map<string, number>();
  const roleCounts: Record<TargetedTag, number> = { ...existingRoles };
  const slotCounts = manaCurve(playedLines);
  let totalSpellsCount = slotCounts.reduce((sum, count) => sum + count, 0);

  const headroomFor = (candidate: DraftCandidate) =>
    remainingCopyRoom(candidate, addedByOracle.get(candidate.oracleId) ?? 0);

  const hasHeadroom = (candidate: DraftCandidate) => headroomFor(candidate) > 0;

  const recordPick = (
    candidate: DraftCandidate,
    section: DraftSection,
    score: number,
    reasons: readonly DraftReason[],
    desiredQuantity: number,
    primaryRole?: TargetedTag,
  ) => {
    const qty = Math.min(
      desiredQuantity,
      headroomFor(candidate),
      Math.max(0, maxNewSpells - draftedCopiesCount),
    );
    if (qty <= 0) return;
    const line = toProfileLine(candidate, qty);
    const spell: DraftedSpell = {
      oracleId: candidate.oracleId,
      name: candidate.name,
      quantity: qty,
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
    addedByOracle.set(candidate.oracleId, (addedByOracle.get(candidate.oracleId) ?? 0) + qty);
    draftedCopiesCount += qty;
    slotCounts[curveSlot(candidate.manaValue)] += qty;
    totalSpellsCount += qty;
    for (const tag of TARGETED_TAGS) {
      if (candidate.roles.includes(tag)) {
        roleCounts[tag] += qty;
      }
    }
  };

  const currentProfile = (): DeckFingerprint => {
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
  while (draftedCopiesCount < maxNewSpells) {
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
      .filter(hasHeadroom)
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
    const deficit = Math.max(1, targets[targetRole] - roleCounts[targetRole]);
    recordPick(best.card, "role", best.score, best.reasons, deficit, targetRole);
  }

  // Step B: Fill remaining role gaps from storePool when allowed.
  if (includeStore !== "none") {
    const exhaustedStoreRoles = new Set<TargetedTag>();
    while (draftedCopiesCount < maxNewSpells) {
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
        .filter(hasHeadroom)
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
      const deficit = Math.max(1, targets[targetRole] - roleCounts[targetRole]);
      recordPick(best.card, "role", best.score, best.reasons, deficit, targetRole);
    }
  }

  // Step C: Owned on-plan spells (themes, tribes, commander keywords).
  if (draftedCopiesCount < maxNewSpells) {
    const planProfile: DeckFingerprint = { ...currentProfile(), gaps: [] };
    const planMatches = ownedPool
      .filter(hasHeadroom)
      .flatMap((candidate) => {
        const scored = scoreForDeck(candidate, planProfile);
        return scored === null
          ? []
          : [{ card: candidate, score: scored.score, reasons: scored.reasons }];
      })
      .sort(compareOwnedFit);

    for (const match of planMatches) {
      if (draftedCopiesCount >= maxNewSpells) break;
      recordPick(match.card, "plan", match.score, match.reasons, headroomFor(match.card));
    }
  }

  // Step D: Owned curve-smoothing playable spells.
  while (draftedCopiesCount < maxNewSpells) {
    const pick = pickCurveCandidate(ownedPool, hasHeadroom, slotCounts, totalSpellsCount, false);
    if (pick === null) break;
    recordPick(
      pick.candidate,
      "curve",
      pick.score,
      [{ kind: "curve", slot: pick.slot }],
      headroomFor(pick.candidate),
    );
  }

  // Step E: Store on-plan and curve fallback when ownedPool is exhausted and store is allowed.
  if (includeStore !== "none" && draftedCopiesCount < maxNewSpells) {
    const planProfile: DeckFingerprint = { ...currentProfile(), gaps: [] };
    const storePlanMatches = storePool
      .filter(hasHeadroom)
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
      if (draftedCopiesCount >= maxNewSpells) break;
      recordPick(match.card, "plan", match.score, match.reasons, headroomFor(match.card));
    }

    while (draftedCopiesCount < maxNewSpells) {
      const pick = pickCurveCandidate(storePool, hasHeadroom, slotCounts, totalSpellsCount, true);
      if (pick === null) break;
      recordPick(
        pick.candidate,
        "curve",
        pick.score,
        [{ kind: "curve", slot: pick.slot }],
        headroomFor(pick.candidate),
      );
    }
  }

  // Reconcile spell count with planManaBase so commanders + spells + lands = targetTotal.
  const landCap = formatRules(input.format).plannedCopyLimit;
  const availableOwnedNonBasics = input.ownedLands
    .filter((land) => !land.isBasicLand)
    .reduce((sum, land) => {
      const already = input.inDeck.get(land.oracleId) ?? 0;
      return sum + Math.max(0, Math.min(landCap, land.ownedCopies) - already);
    }, 0);
  const maxAddableLands = input.basics.length > 0 ? maxNewSpells : availableOwnedNonBasics;

  const landsAddedForPrefix = (prefixCopies: number): number => {
    const trialLines = [
      ...playedLines,
      ...takeSpellCopies(drafted, prefixCopies).map((entry) => entry.line),
    ];
    const desiredLands = landTarget(input.format, deckStats(trialLines)).lands;
    const deficit = Math.max(0, desiredLands - existingLands);
    return Math.min(deficit, maxAddableLands);
  };

  const initialLandHeadroom = Math.min(
    draftedCopiesCount,
    Math.max(
      0,
      maxNewSpells - Math.max(0, landTarget(input.format, initialStats).lands - existingLands),
    ),
  );
  let keptSpellCount = Math.min(
    draftedCopiesCount,
    Math.max(0, maxNewSpells - landsAddedForPrefix(initialLandHeadroom)),
  );
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const landsToAdd = landsAddedForPrefix(keptSpellCount);
    keptSpellCount = Math.min(draftedCopiesCount, Math.max(0, maxNewSpells - landsToAdd));
  }

  let keptEntries = takeSpellCopies(drafted, keptSpellCount);
  const combinedLines = [...playedLines, ...keptEntries.map((entry) => entry.line)];
  const combinedInDeck = new Map(input.inDeck);
  for (const entry of keptEntries) {
    combinedInDeck.set(
      entry.spell.oracleId,
      (combinedInDeck.get(entry.spell.oracleId) ?? 0) + entry.spell.quantity,
    );
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

  // If a curve threshold boundary caused spell copies + plannedLandAdditions to differ by 1
  // from maxNewSpells while we have enough drafted spells, align keptEntries to hit targetTotal.
  const exactSpellTarget = Math.max(0, maxNewSpells - plannedLandAdditions);
  const currentKeptCopies = totalSpellCopies(keptEntries);
  if (
    (currentKeptCopies !== exactSpellTarget && draftedCopiesCount >= exactSpellTarget) ||
    existingCount + currentKeptCopies + plannedLandAdditions > targetTotal
  ) {
    keptEntries = takeSpellCopies(drafted, exactSpellTarget);
  }

  // Collapse repeated picks of the same card (e.g. partial role fill + extra plan/curve copies).
  const mergedEntries = new Map<string, DraftEntry>();
  for (const entry of keptEntries) {
    const key = `${entry.spell.oracleId}:${entry.spell.pool}`;
    const existing = mergedEntries.get(key);
    if (existing === undefined) {
      mergedEntries.set(key, entry);
      continue;
    }
    const mergedQuantity = existing.spell.quantity + entry.spell.quantity;
    mergedEntries.set(key, {
      ...existing,
      spell: { ...existing.spell, quantity: mergedQuantity },
      line: { ...existing.line, quantity: mergedQuantity },
    });
  }
  const finalEntries = [...mergedEntries.values()];
  const spells = finalEntries.map((entry) => entry.spell);
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

  for (const entry of finalEntries) {
    for (const tag of TARGETED_TAGS) {
      if (!entry.candidate.roles.includes(tag)) continue;
      if (entry.spell.pool === "owned") {
        ownedAddedByRole[tag] += entry.spell.quantity;
      } else {
        storeAddedByRole[tag] += entry.spell.quantity;
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

  const ownedSpellCount = spells
    .filter((spell) => spell.pool === "owned")
    .reduce((sum, spell) => sum + spell.quantity, 0);
  const storeSpells = spells.filter((spell) => spell.pool === "store");
  const storeAddedCount = storeSpells.reduce((sum, spell) => sum + spell.quantity, 0);
  const storeCostCents = storeSpells.reduce(
    (sum, spell) => sum + (spell.priceCents ?? 0) * spell.quantity,
    0,
  );
  const ownedAddedCount = ownedSpellCount + plannedLandAdditions;
  const totalAfterDraft = existingCount + totalSpellCopies(finalEntries) + plannedLandAdditions;

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
