import type { FormatRuleSet } from "./format-rules";
import type {
  BattlefieldPermanent,
  EndStepTrigger,
  GoldfishCard,
  GoldfishState,
  GoldfishZone,
} from "./goldfish-types";
import { addMana, EMPTY_MANA_POOL, type ManaColor, type ManaPool } from "./mana";

// Open-Closed Modifier & Trigger Pipelines for Play Simulation.
// New casting mechanics (alt costs, taxes, cost reducers) and triggered abilities
// are registered as plugins without adding card- or commander-specific branches to stepGoldfishState.

export type CastModifierContext = Readonly<{
  state: GoldfishState;
  card: GoldfishCard;
  from: GoldfishZone;
  alt?: string;
  explicitReductionGeneric?: number;
  formatRules: FormatRuleSet;
}>;

export type CostPhase = "base" | "increase" | "reduction" | "minimum";

export type CastModifierResult = Readonly<{
  allowed: boolean;
  reason?: string;
  /** Positive = tax, negative = discount, or minimum total generic+mana floor when phase === "minimum". */
  genericDelta?: number;
  /** Minimum total mana value floor (e.g. Trinisphere = 3). */
  minimumTotalCost?: number;
  /** Runtime abilities granted to the resulting permanent (e.g. "haste", "blitzed"). */
  grantAbilities?: readonly string[];
  /** Delayed triggers enqueued on resolution/entry. */
  enqueueTriggers?: readonly EndStepTrigger[];
  /** Optional label appended to the cast note/cost string. */
  taxLabel?: string;
}>;

export interface CastModifier {
  readonly id: string;
  /** CR 601.2f evaluation order: base/alt -> increase -> reduction -> minimum (defaults to "increase"). */
  readonly phase?: CostPhase;
  applies(ctx: CastModifierContext): boolean;
  apply(ctx: CastModifierContext): CastModifierResult;
}

export type EnterBattlefieldIntent = Readonly<{
  card: GoldfishCard;
  from: GoldfishZone | "token";
  tapped: boolean;
  abilities: readonly string[];
  counters: Readonly<Record<string, number>>;
}>;

/** CR 614 Replacement Effect: intercepts an entering permanent before it hits the battlefield. */
export interface ReplacementEffect {
  readonly id: string;
  applies(intent: EnterBattlefieldIntent, state: GoldfishState): boolean;
  replace(intent: EnterBattlefieldIntent, state: GoldfishState): EnterBattlefieldIntent;
}

export type ZoneChangeIntent = Readonly<{
  card: GoldfishCard;
  from: GoldfishZone | "token";
  to: Exclude<GoldfishZone, "library"> | "library_top" | "library_bottom";
  previousPermanent?: BattlefieldPermanent;
}>;

/** CR 614 Replacement Effect for non-ETB zone transitions (e.g. Rest in Peace graveyard -> exile). */
export interface ZoneChangeReplacement {
  readonly id: string;
  applies(intent: ZoneChangeIntent, state: GoldfishState): boolean;
  replace(intent: ZoneChangeIntent, state: GoldfishState): ZoneChangeIntent;
}

export type ActivatedAbilityContext = Readonly<{
  state: GoldfishState;
  source: BattlefieldPermanent;
  sacrificeKey?: string;
  zoneReplacements?: readonly ZoneChangeReplacement[];
}>;

export type ActivatedAbilityResult =
  | Readonly<{
      ok: true;
      state: GoldfishState;
      events: readonly GameEvent[];
      note: string;
    }>
  | Readonly<{
      ok: false;
      reason: string;
    }>;

export interface ActivatedAbility {
  readonly id: string;
  canActivate(source: BattlefieldPermanent, state: GoldfishState): boolean;
  activate(ctx: ActivatedAbilityContext): ActivatedAbilityResult;
}

export type GameEvent =
  | Readonly<{
      kind: "SpellCast";
      card: GoldfishCard;
      from: GoldfishZone;
      to: GoldfishZone;
      alt?: string;
    }>
  | Readonly<{ kind: "PermanentEntered"; permanent: BattlefieldPermanent }>
  | Readonly<{
      kind: "ZoneChanged";
      card: GoldfishCard;
      from: GoldfishZone | "token";
      to: GoldfishZone;
      previousPermanent?: BattlefieldPermanent;
    }>
  | Readonly<{ kind: "PhaseEnded"; phase: "end_step" | "end_combat" }>
  | Readonly<{ kind: "PermanentTapped"; permanent: BattlefieldPermanent }>
  | Readonly<{ kind: "CreatureAttacked"; permanent: BattlefieldPermanent; opponentCount: number }>;

export type TriggerOutcome = Readonly<{
  state: GoldfishState;
  events?: readonly GameEvent[];
  notes?: readonly string[];
}>;

export interface TriggerHandler {
  readonly id: string;
  handles(event: GameEvent, state: GoldfishState): boolean;
  run(event: GameEvent, state: GoldfishState): TriggerOutcome;
}

export type ZonePermissionContext = Readonly<{
  state: GoldfishState;
  card: GoldfishCard;
  from: GoldfishZone;
}>;

export type ZonePermissionResult = Readonly<{
  allowed: boolean;
  usageKey?: string;
  reason?: string;
}>;

/** CR 601.2 / 601.3: Grants permission to cast spells from non-hand zones (e.g. Muldrotha, Mystic Forge). */
export interface ZoneCastPermission {
  readonly id: string;
  applies(ctx: ZonePermissionContext): boolean;
  check(ctx: ZonePermissionContext): ZonePermissionResult;
}

export type SimulationPipeline = Readonly<{
  castModifiers?: readonly CastModifier[];
  zonePermissions?: readonly ZoneCastPermission[];
  replacementEffects?: readonly ReplacementEffect[];
  zoneReplacements?: readonly ZoneChangeReplacement[];
  triggerHandlers?: readonly TriggerHandler[];
  activatedAbilities?: readonly ActivatedAbility[];
}>;

// --- Mini Layer 6 static keyword evaluator & State-Based Actions (CR 704) ---

/** Evaluate whether a battlefield permanent has a keyword via runtime abilities, card text, attachments, or battlefield static grants. */
export function permanentHasKeyword(
  perm: BattlefieldPermanent,
  keyword: "haste" | "vigilance" | "defender",
  state: GoldfishState,
): boolean {
  if (keyword === "haste" && perm.haste) return true;
  if (perm.abilities?.includes(keyword)) return true;
  if (new RegExp(`\\b${keyword}\\b`, "i").test(perm.card.text ?? "")) return true;
  // Attached Equipment/Auras granting keyword (CR 301.5 / 303.4 Layer 6)
  const attachGrant = new RegExp(`\\b(?:equipped|enchanted) creature[^.\\n]*\\b${keyword}\\b`, "i");
  if (
    state.battlefield.some(
      (att) => att.attachedTo === perm.card.key && attachGrant.test(att.card.text ?? ""),
    )
  ) {
    return true;
  }
  if (/\bCreature\b/i.test(perm.card.typeLine)) {
    const grantPattern = new RegExp(`\\bcreatures you control have[^.\\n]*\\b${keyword}\\b`, "i");
    if (state.battlefield.some((other) => grantPattern.test(other.card.text ?? ""))) {
      return true;
    }
  }
  return false;
}

/** Count how many land drops are allowed this turn (base 1 + static battlefield grants like Exploration). */
export function allowedLandDropsThisTurn(state: GoldfishState): number {
  let extra = 0;
  for (const perm of state.battlefield) {
    const text = perm.card.text ?? "";
    if (/\bplay an additional land\b/i.test(text)) extra += 1;
    else if (/\bplay two additional lands\b/i.test(text)) extra += 2;
  }
  return 1 + extra;
}

/**
 * CR 704 State-Based Actions:
 * - 704.5m: Illegally attached Auras are put into their owner's graveyard.
 * - 704.5p: Illegally attached Equipment becomes unattached and stays on the battlefield.
 * - 704.5q: +1/+1 & -1/-1 counters annihilate 1-for-1.
 * - 704.5d: Tokens in non-battlefield zones cease to exist.
 */
export function runStateBasedActions(state: GoldfishState): GoldfishState {
  let changed = false;
  const battlefieldKeys = new Set(state.battlefield.map((p) => p.card.key));
  const auraGraveyard: GoldfishCard[] = [];
  const nextBattlefield: BattlefieldPermanent[] = [];

  for (const p of state.battlefield) {
    let perm = p;
    if (perm.attachedTo && !battlefieldKeys.has(perm.attachedTo)) {
      changed = true;
      if (/\bAura\b/i.test(perm.card.typeLine)) {
        // CR 704.5m: Aura attached to nothing goes to graveyard
        if (!perm.card.isToken) auraGraveyard.push(perm.card);
        continue;
      }
      // CR 704.5p: Equipment simply unattaches
      perm = { ...perm, attachedTo: undefined };
    }

    const plus = perm.counters?.["+1/+1"] ?? 0;
    const minus = perm.counters?.["-1/-1"] ?? 0;
    if (plus > 0 && minus > 0) {
      changed = true;
      const annihilate = Math.min(plus, minus);
      const nextCounters: Record<string, number> = { ...perm.counters };
      if (plus - annihilate > 0) nextCounters["+1/+1"] = plus - annihilate;
      else delete nextCounters["+1/+1"];
      if (minus - annihilate > 0) nextCounters["-1/-1"] = minus - annihilate;
      else delete nextCounters["-1/-1"];
      perm = {
        ...perm,
        counters: Object.keys(nextCounters).length > 0 ? nextCounters : undefined,
      };
    }
    nextBattlefield.push(perm);
  }

  const stripTokens = (list: readonly GoldfishCard[]) => {
    const filtered = list.filter((c) => !c.isToken);
    if (filtered.length !== list.length) changed = true;
    return filtered;
  };

  const graveyard = [...stripTokens(state.graveyard), ...auraGraveyard];
  const exile = stripTokens(state.exile);
  const hand = stripTokens(state.hand);
  const library = stripTokens(state.library);

  return changed
    ? { ...state, battlefield: nextBattlefield, graveyard, exile, hand, library }
    : state;
}

// --- Zone helpers shared by pipeline & session ---

export function removeCardFromZone(
  state: GoldfishState,
  zone: GoldfishZone,
  key: string,
): { card: GoldfishCard; permanent?: BattlefieldPermanent; next: GoldfishState } | null {
  if (zone === "battlefield") {
    const idx = state.battlefield.findIndex((p) => p.card.key === key);
    if (idx === -1) return null;
    const permanent = state.battlefield[idx];
    const battlefield = state.battlefield.filter((_, i) => i !== idx);
    return { card: permanent.card, permanent, next: { ...state, battlefield } };
  }
  const list = state[zone];
  const idx = list.findIndex((c) => c.key === key);
  if (idx === -1) return null;
  const card = list[idx];
  const updated = list.filter((_, i) => i !== idx);
  return { card, next: { ...state, [zone]: updated } };
}

export function addCardToZone(
  state: GoldfishState,
  to: Exclude<GoldfishZone, "library"> | "library_top" | "library_bottom",
  card: GoldfishCard,
  opts: {
    tapped?: boolean;
    abilities?: readonly string[];
    counters?: Readonly<Record<string, number>>;
    from?: GoldfishZone | "token";
    replacementEffects?: readonly ReplacementEffect[];
  } = {},
): GoldfishState {
  switch (to) {
    case "hand":
      return { ...state, hand: [...state.hand, card] };
    case "battlefield": {
      let intent: EnterBattlefieldIntent = {
        card,
        from: opts.from ?? "hand",
        tapped: opts.tapped ?? false,
        abilities: opts.abilities ?? [],
        counters: opts.counters ?? {},
      };
      for (const rep of opts.replacementEffects ?? []) {
        if (rep.applies(intent, state)) {
          intent = rep.replace(intent, state);
        }
      }
      const haste = intent.abilities.includes("haste") || /\bhaste\b/i.test(intent.card.text ?? "");
      const blitzed = intent.abilities.includes("blitzed");
      return {
        ...state,
        battlefield: [
          ...state.battlefield,
          {
            card: intent.card,
            tapped: intent.tapped,
            enteredTurn: state.turn,
            ...(intent.abilities.length > 0 ? { abilities: intent.abilities } : {}),
            ...(Object.keys(intent.counters).length > 0 ? { counters: intent.counters } : {}),
            ...(haste ? { haste: true } : {}),
            ...(blitzed ? { blitzed: true } : {}),
          },
        ],
      };
    }
    case "graveyard":
      return { ...state, graveyard: [...state.graveyard, card] };
    case "exile":
      return { ...state, exile: [...state.exile, card] };
    case "commandZone":
      return { ...state, commandZone: [...state.commandZone, card] };
    case "library_top":
      return { ...state, library: [card, ...state.library] };
    case "library_bottom":
      return { ...state, library: [...state.library, card] };
  }
}

// --- Built-in CastModifiers ---

const commanderTaxModifier: CastModifier = {
  id: "commander_tax",
  phase: "increase",
  applies: (ctx) => ctx.from === "commandZone" && ctx.formatRules.commandZoneTaxPerCast > 0,
  apply: (ctx) => {
    const castsForCard =
      ctx.state.commandCastsByKey?.[ctx.card.key] ??
      (ctx.state.commandZone.length <= 1 ? ctx.state.commandCasts : 0);
    const tax = castsForCard * ctx.formatRules.commandZoneTaxPerCast;
    return {
      allowed: true,
      genericDelta: tax,
      ...(tax > 0 ? { taxLabel: `{${tax}} tax` } : {}),
    };
  },
};

const explicitCostReductionModifier: CastModifier = {
  id: "explicit_cost_reduction",
  phase: "reduction",
  applies: (ctx) => (ctx.explicitReductionGeneric ?? 0) > 0,
  apply: (ctx) => ({
    allowed: true,
    genericDelta: -Math.max(0, ctx.explicitReductionGeneric ?? 0),
  }),
};

const blitzCastModifier: CastModifier = {
  id: "alt_blitz",
  phase: "base",
  applies: (ctx) => ctx.alt === "blitz",
  apply: (ctx) => {
    const hasOwnBlitz = /\bblitz\b/i.test(ctx.card.text ?? "");
    const hasBattlefieldBlitzGranter = ctx.state.battlefield.some((p) =>
      /\bhave blitz\b|\bhas blitz\b/i.test(p.card.text ?? ""),
    );
    if (!hasOwnBlitz && !hasBattlefieldBlitzGranter) {
      return {
        allowed: false,
        reason:
          "Cannot cast with blitz: no blitz-granting permanent is on the battlefield and the card does not have blitz.",
      };
    }
    if (!hasOwnBlitz && !/\bCreature\b/i.test(ctx.card.typeLine)) {
      return {
        allowed: false,
        reason: "Cannot cast with blitz: only creature spells can be blitzed.",
      };
    }
    return {
      allowed: true,
      grantAbilities: ["haste", "blitzed"],
      enqueueTriggers: [{ key: ctx.card.key, kind: "sacrifice_blitz" }],
    };
  },
};

const freeAltCastModifier: CastModifier = {
  id: "alt_free",
  phase: "base",
  applies: (ctx) => ctx.alt === "free",
  apply: (ctx) => ({
    allowed: true,
    // Negate base generic cost (CR 118.9a); additional costs like commander tax still apply in increase phase
    genericDelta: -Math.max(0, ctx.card.manaValue ?? 0),
  }),
};

export const DEFAULT_CAST_MODIFIERS: readonly CastModifier[] = [
  commanderTaxModifier,
  explicitCostReductionModifier,
  blitzCastModifier,
  freeAltCastModifier,
];

// --- Built-in ZoneCastPermissions (CR 601.2 / 601.3) ---

const muldrothaGraveyardPermission: ZoneCastPermission = {
  id: "muldrotha_graveyard_permanent",
  applies: (ctx) =>
    ctx.from === "graveyard" &&
    ctx.state.battlefield.some((p) =>
      /cast a permanent spell of each permanent type from your graveyard/i.test(p.card.text ?? ""),
    ),
  check(ctx) {
    const tl = ctx.card.typeLine;
    const permTypes = ["Artifact", "Creature", "Enchantment", "Planeswalker", "Battle"].filter(
      (t) => new RegExp(`\\b${t}\\b`, "i").test(tl),
    );
    if (permTypes.length === 0) {
      return { allowed: false, reason: `${ctx.card.name} is not a permanent spell.` };
    }
    const availableType = permTypes.find(
      (t) => (ctx.state.turnUsage?.[`muldrotha:${t}`] ?? 0) === 0,
    );
    if (!availableType) {
      return {
        allowed: false,
        reason: `Already cast a ${permTypes.join("/")} spell from graveyard this turn.`,
      };
    }
    return { allowed: true, usageKey: `muldrotha:${availableType}` };
  },
};

const mysticForgeTopPermission: ZoneCastPermission = {
  id: "mystic_forge_top_of_library",
  applies: (ctx) =>
    ctx.from === "library" &&
    ctx.state.library[0]?.key === ctx.card.key &&
    ctx.state.battlefield.some((p) =>
      /cast artifact spells and colorless spells from the top of your library/i.test(
        p.card.text ?? "",
      ),
    ),
  check(ctx) {
    const isArtifact = /\bArtifact\b/i.test(ctx.card.typeLine);
    const isColorless = !/\{[WUBRG]\}/i.test(ctx.card.manaCost ?? "");
    if (!isArtifact && !isColorless) {
      return {
        allowed: false,
        reason: `${ctx.card.name} is neither an artifact nor a colorless spell.`,
      };
    }
    return { allowed: true };
  },
};

export const DEFAULT_ZONE_PERMISSIONS: readonly ZoneCastPermission[] = [
  muldrothaGraveyardPermission,
  mysticForgeTopPermission,
];

// --- Built-in TriggerHandlers ---

const endStepDelayedTriggerHandler: TriggerHandler = {
  id: "end_step_delayed_triggers",
  handles: (event) => event.kind === "PhaseEnded" && event.phase === "end_step",
  run(_event, state) {
    const dueTriggers = state.endStepQueue.filter((t) => (t.dueTurn ?? state.turn) <= state.turn);
    const futureTriggers = state.endStepQueue.filter((t) => (t.dueTurn ?? state.turn) > state.turn);
    // Remove due triggers upfront so any new triggers enqueued during end_step are preserved
    let next: GoldfishState = { ...state, endStepQueue: futureTriggers };
    const emitted: GameEvent[] = [];
    const notes: string[] = [];
    const sacrificed: string[] = [];
    const returned: string[] = [];
    let drawn = 0;

    for (const trigger of dueTriggers) {
      if (trigger.kind === "sacrifice_blitz") {
        const removed = removeCardFromZone(next, "battlefield", trigger.key);
        if (!removed) continue;
        next = addCardToZone(removed.next, "graveyard", removed.card);
        sacrificed.push(removed.card.name);
        emitted.push({
          kind: "ZoneChanged",
          card: removed.card,
          from: "battlefield",
          to: "graveyard",
          previousPermanent: removed.permanent,
        });
        if (next.library.length > 0) {
          const [top, ...rest] = next.library;
          next = { ...next, hand: [...next.hand, top], library: rest };
          drawn += 1;
        }
      } else if (trigger.kind === "return_to_battlefield") {
        const back = removeCardFromZone(next, "graveyard", trigger.key);
        if (!back) continue;
        next = addCardToZone(back.next, "battlefield", back.card);
        returned.push(back.card.name);
        emitted.push({
          kind: "ZoneChanged",
          card: back.card,
          from: "graveyard",
          to: "battlefield",
        });
      }
    }

    next = {
      ...next,
      battlefield: next.battlefield.map((p) => {
        const abilities = p.abilities?.filter((a) => a !== "attacking");
        return {
          ...p,
          ...(abilities && abilities.length > 0 ? { abilities } : { abilities: undefined }),
          tempModifiers: undefined,
        };
      }),
    };
    if (sacrificed.length > 0) {
      notes.push(`sacrificed ${sacrificed.join(", ")} (blitz) and drew ${drawn} card(s)`);
    }
    if (returned.length > 0) {
      notes.push(`returned ${returned.join(", ")} to the battlefield`);
    }
    return { state: next, events: emitted, notes };
  },
};

const endCombatExileHandler: TriggerHandler = {
  id: "end_combat_exile_tokens",
  handles: (event) => event.kind === "PhaseEnded" && event.phase === "end_combat",
  run(_event, state) {
    let next = state;
    const exiled: string[] = [];
    const emitted: GameEvent[] = [];
    for (const perm of state.battlefield) {
      if (!perm.abilities?.includes("exile_at_end_of_combat")) continue;
      const removed = removeCardFromZone(next, "battlefield", perm.card.key);
      if (!removed) continue;
      next = perm.card.isToken ? removed.next : addCardToZone(removed.next, "exile", removed.card);
      exiled.push(perm.card.name);
      emitted.push({
        kind: "ZoneChanged",
        card: removed.card,
        from: "battlefield",
        to: "exile",
        previousPermanent: removed.permanent,
      });
    }
    // Remove attacking status at end of combat
    next = {
      ...next,
      battlefield: next.battlefield.map((p) => ({
        ...p,
        abilities: p.abilities?.filter((a) => a !== "attacking"),
      })),
    };
    return {
      state: next,
      events: emitted,
      notes: exiled.length > 0 ? [`exiled ${exiled.join(", ")} at end of combat`] : [],
    };
  },
};

const diesReturnTriggerHandler: TriggerHandler = {
  id: "dies_return_undying_persist",
  handles: (event) =>
    event.kind === "ZoneChanged" && event.from === "battlefield" && event.to === "graveyard",
  run(event, state) {
    if (event.kind !== "ZoneChanged") return { state };
    const text = event.card.text ?? "";
    const counters = event.previousPermanent?.counters ?? {};
    const hasUndying = /\bundying\b/i.test(text) && (counters["+1/+1"] ?? 0) === 0;
    const hasPersist = /\bpersist\b/i.test(text) && (counters["-1/-1"] ?? 0) === 0;
    if (!hasUndying && !hasPersist) return { state };

    const back = removeCardFromZone(state, "graveyard", event.card.key);
    if (!back) return { state };

    const nextCounters = hasUndying
      ? { ...counters, "+1/+1": (counters["+1/+1"] ?? 0) + 1 }
      : { ...counters, "-1/-1": (counters["-1/-1"] ?? 0) + 1 };

    const next = addCardToZone(back.next, "battlefield", back.card, { counters: nextCounters });
    const keyword = hasUndying ? "undying" : "persist";
    return {
      state: next,
      notes: [`returned ${back.card.name} to the battlefield (${keyword})`],
    };
  },
};

export const DEFAULT_REPLACEMENT_EFFECTS: readonly ReplacementEffect[] = [];

const sacrificeForManaAbility: ActivatedAbility = {
  id: "sacrifice_creature_for_mana",
  canActivate: (source) =>
    /sacrifice\s+(?:a|another)\s+creature[^:\n]*:\s*add\b/i.test(source.card.text ?? ""),
  activate(ctx) {
    if (!ctx.sacrificeKey) {
      return { ok: false, reason: `Choose a creature to sacrifice for ${ctx.source.card.name}.` };
    }
    const target = ctx.state.battlefield.find((p) => p.card.key === ctx.sacrificeKey);
    if (!target || !/\bCreature\b/i.test(target.card.typeLine)) {
      return { ok: false, reason: `${ctx.sacrificeKey} is not a creature on the battlefield.` };
    }
    const removed = removeCardFromZone(ctx.state, "battlefield", ctx.sacrificeKey);
    if (!removed) return { ok: false, reason: `Creature ${ctx.sacrificeKey} not found.` };

    let intent: ZoneChangeIntent = {
      card: removed.card,
      from: "battlefield",
      to: "graveyard",
      previousPermanent: removed.permanent,
    };
    for (const rep of ctx.zoneReplacements ?? []) {
      if (rep.applies(intent, removed.next)) {
        intent = rep.replace(intent, removed.next);
      }
    }

    const afterZone = addCardToZone(removed.next, intent.to, removed.card);
    const finalDest: GoldfishZone =
      intent.to === "library_top" || intent.to === "library_bottom" ? "library" : intent.to;

    const text = ctx.source.card.text ?? "";
    const addMatch = text.match(/sacrifice[^:\n]*:\s*add\s+((?:\{[WUBRGC]\})+)/i);
    const added: ManaPool = { ...EMPTY_MANA_POOL };
    if (addMatch) {
      const syms = addMatch[1].match(/\{([WUBRGC])\}/gi) ?? [];
      for (const s of syms) {
        added[s.slice(1, -1).toUpperCase() as ManaColor] += 1;
      }
    } else {
      added.C += 1;
    }

    return {
      ok: true,
      state: runStateBasedActions({
        ...afterZone,
        manaPool: addMana(afterZone.manaPool, added),
      }),
      events: [
        {
          kind: "ZoneChanged",
          card: removed.card,
          from: "battlefield",
          to: finalDest,
          previousPermanent: removed.permanent,
        },
      ],
      note: `Sacrificed ${removed.card.name} to ${ctx.source.card.name}.`,
    };
  },
};

export const DEFAULT_ACTIVATED_ABILITIES: readonly ActivatedAbility[] = [sacrificeForManaAbility];

const cascadeTriggerHandler: TriggerHandler = {
  id: "cascade_on_cast",
  handles: (event, state) => {
    if (event.kind !== "SpellCast") return false;
    const hasOwnCascade = /\bcascade\b/i.test(event.card.text ?? "");
    const hasZhulodok =
      event.from === "hand" &&
      (event.card.manaValue ?? 0) >= 7 &&
      !/\{[WUBRG]\}/i.test(event.card.manaCost ?? "") &&
      state.battlefield.some((p) =>
        /colorless spells you cast from your hand with mana value 7 or greater have "cascade, cascade/i.test(
          p.card.text ?? "",
        ),
      );
    return hasOwnCascade || hasZhulodok;
  },
  run(event, state) {
    if (event.kind !== "SpellCast") return { state };
    const sourceMv = event.card.manaValue ?? 0;
    const isDouble =
      /cascade,\s*cascade/i.test(event.card.text ?? "") ||
      state.battlefield.some((p) => /"cascade,\s*cascade"/i.test(p.card.text ?? ""));
    const cascadeCount = isDouble ? 2 : 1;

    let next = state;
    const emitted: GameEvent[] = [];
    const notes: string[] = [];

    for (let c = 0; c < cascadeCount; c++) {
      const bottomed: GoldfishCard[] = [];
      let hit: GoldfishCard | null = null;
      const lib = [...next.library];
      while (lib.length > 0) {
        const top = lib.shift();
        if (!top) break;
        const isLandCard = top.isLand;
        const mv = top.manaValue ?? 0;
        if (!isLandCard && mv < sourceMv) {
          hit = top;
          break;
        }
        bottomed.push(top);
      }
      next = { ...next, library: [...lib, ...bottomed] };
      if (hit) {
        const lower = hit.typeLine.toLowerCase();
        const isSpellOnly =
          (lower.includes("instant") || lower.includes("sorcery")) &&
          !lower.includes("creature") &&
          !lower.includes("artifact") &&
          !lower.includes("enchantment") &&
          !lower.includes("planeswalker");
        const dest = isSpellOnly ? "graveyard" : "battlefield";
        next = addCardToZone(next, dest, hit, { from: "exile" });
        notes.push(`cascaded into ${hit.name}`);
        emitted.push({ kind: "ZoneChanged", card: hit, from: "exile", to: dest });
        if (dest === "battlefield") {
          const entered = next.battlefield[next.battlefield.length - 1];
          if (entered) emitted.push({ kind: "PermanentEntered", permanent: entered });
        }
      }
    }
    return { state: next, events: emitted, notes };
  },
};

export const DEFAULT_TRIGGER_HANDLERS: readonly TriggerHandler[] = [
  endStepDelayedTriggerHandler,
  endCombatExileHandler,
  diesReturnTriggerHandler,
  cascadeTriggerHandler,
];

/** Dispatch a list of GameEvents through registered TriggerHandlers (breadth-first, bounded). */
export function dispatchGameEvents(
  initialState: GoldfishState,
  initialEvents: readonly GameEvent[],
  handlers: readonly TriggerHandler[] = DEFAULT_TRIGGER_HANDLERS,
): { state: GoldfishState; notes: string[] } {
  let state = initialState;
  const queue: GameEvent[] = [...initialEvents];
  const notes: string[] = [];
  const MAX_STEPS = 64;
  let steps = 0;

  while (queue.length > 0 && steps < MAX_STEPS) {
    steps++;
    const event = queue.shift();
    if (!event) break;
    for (const handler of handlers) {
      if (!handler.handles(event, state)) continue;
      const outcome = handler.run(event, state);
      state = outcome.state;
      if (outcome.events) queue.push(...outcome.events);
      if (outcome.notes) notes.push(...outcome.notes);
    }
  }
  return { state: runStateBasedActions(state), notes };
}
