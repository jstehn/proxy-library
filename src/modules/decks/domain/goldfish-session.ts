import { cardTags } from "@/shared/card-search";
import { err, ok, shuffled, type Result, type Rng } from "@/shared/kernel";
import { getFormatRules, type FormatRuleSet } from "./format-rules";
import type {
  BattlefieldPermanent,
  EndStepTrigger,
  GoldfishCard,
  GoldfishDeckLine,
  GoldfishState,
  GoldfishZone,
} from "./goldfish-types";
import {
  addMana,
  EMPTY_MANA_POOL,
  extractTapManaProduction,
  parseManaCost,
  spendMana,
  type ManaPool,
  type ParsedManaCost,
} from "./mana";
import { OPENING_HAND } from "./draws";
import {
  addCardToZone,
  allowedLandDropsThisTurn,
  DEFAULT_ACTIVATED_ABILITIES,
  DEFAULT_CAST_MODIFIERS,
  DEFAULT_REPLACEMENT_EFFECTS,
  DEFAULT_TRIGGER_HANDLERS,
  DEFAULT_ZONE_PERMISSIONS,
  dispatchGameEvents,
  permanentHasKeyword,
  removeCardFromZone,
  type SimulationPipeline,
  type ZoneChangeIntent,
} from "./sim-pipeline";
import { isLand } from "./stats";

export { type ManaColor, type ManaPool, type ParsedManaCost } from "./mana";
export type {
  BattlefieldPermanent,
  EndStepTrigger,
  GoldfishCard,
  GoldfishDeckLine,
  GoldfishState,
  GoldfishZone,
} from "./goldfish-types";
export type {
  ActivatedAbility,
  ActivatedAbilityContext,
  ActivatedAbilityResult,
  CastModifier,
  CastModifierContext,
  CastModifierResult,
  EnterBattlefieldIntent,
  GameEvent,
  ReplacementEffect,
  SimulationPipeline,
  TriggerHandler,
  TriggerOutcome,
  ZoneChangeIntent,
  ZoneChangeReplacement,
  ZoneCastPermission,
  ZonePermissionContext,
  ZonePermissionResult,
} from "./sim-pipeline";

// Interactive turn-by-turn tabletop goldfish state machine (design doc 60 + 61, Phase 63).
// Pure and deterministic via injected Rng (ADR 0008).

export type GoldfishAction =
  | Readonly<{ kind: "mulligan"; rng: Rng }>
  | Readonly<{ kind: "bottom"; keys: readonly string[] }>
  | Readonly<{ kind: "keep" }>
  | Readonly<{ kind: "next_turn" }>
  | Readonly<{ kind: "end_step" }>
  | Readonly<{ kind: "draw"; count?: number }>
  | Readonly<{ kind: "play_land"; key: string; tapped?: boolean; ignoreLandLimit?: boolean }>
  | Readonly<{
      kind: "cast";
      key: string;
      from?: "hand" | "commandZone" | "graveyard" | "exile" | "library";
      to?: "battlefield" | "graveyard" | "exile";
      tapped?: boolean;
      alt?: string;
      strict?: boolean;
      costReductionGeneric?: number;
    }>
  | Readonly<{ kind: "tap"; key: string }>
  | Readonly<{ kind: "untap"; key: string }>
  | Readonly<{ kind: "activate"; key: string; sacrificeKey?: string }>
  | Readonly<{ kind: "attach"; key: string; targetKey: string }>
  | Readonly<{ kind: "mill"; count?: number }>
  | Readonly<{ kind: "attack"; keys: readonly string[]; opponentCount?: number }>
  | Readonly<{ kind: "end_combat" }>
  | Readonly<{
      kind: "move";
      key: string;
      from: GoldfishZone;
      to: Exclude<GoldfishZone, "library"> | "library_top" | "library_bottom";
    }>
  | Readonly<{ kind: "shuffle_library"; rng: Rng }>;

export type GoldfishError =
  | Readonly<{ kind: "MulliganNotAllowed"; reason: string }>
  | Readonly<{ kind: "PendingBottom"; remaining: number }>
  | Readonly<{ kind: "CardNotFound"; key: string; zone?: GoldfishZone }>
  | Readonly<{ kind: "NotALand"; key: string; name: string }>
  | Readonly<{ kind: "LandLimitReached"; landsPlayedThisTurn: number }>
  | Readonly<{ kind: "InvalidBottomSelection"; expected: number; received: number }>
  | Readonly<{ kind: "CastNotAllowed"; reason: string }>
  | Readonly<{ kind: "InsufficientMana"; card: string; required: string; available: ManaPool }>
  | Readonly<{ kind: "EmptyLibrary" }>;

export type StartGoldfishOptions = Readonly<{
  format: string;
  rng: Rng;
  onTheDraw?: boolean;
  freeMulligan?: boolean;
}>;

export function buildGoldfishDeck(lines: readonly GoldfishDeckLine[]): {
  library: GoldfishCard[];
  commandZone: GoldfishCard[];
} {
  const libraryCards: GoldfishCard[] = [];
  const commandZone: GoldfishCard[] = [];
  let cmdSeq = 1;
  let libSeq = 1;

  for (const line of lines) {
    if (line.board !== "main" && line.board !== "commander") continue;
    const isCommander = line.board === "commander";
    const tags = cardTags({
      typeLine: line.typeLine,
      text: line.text ?? "",
      producedMana: line.producedMana,
    });
    for (let copy = 0; copy < line.quantity; copy++) {
      const key = isCommander ? `c${cmdSeq++}` : `k${libSeq++}`;
      const card: GoldfishCard = {
        key,
        oracleId: line.oracleId,
        name: line.name,
        printingId: line.printingId,
        typeLine: line.typeLine,
        ...(line.manaCost ? { manaCost: line.manaCost } : {}),
        ...(line.manaValue !== undefined ? { manaValue: line.manaValue } : {}),
        ...(line.text ? { text: line.text } : {}),
        ...(line.producedMana && line.producedMana.length > 0
          ? { producedMana: line.producedMana }
          : {}),
        isLand: isLand(line.typeLine),
        isCommander,
        tags,
      };
      if (isCommander) commandZone.push(card);
      else libraryCards.push(card);
    }
  }
  return { library: libraryCards, commandZone };
}

export function startGoldfishState(
  deck: Readonly<{ library: readonly GoldfishCard[]; commandZone: readonly GoldfishCard[] }>,
  options: StartGoldfishOptions,
): Result<GoldfishState, GoldfishError> {
  if (deck.library.length === 0) return err({ kind: "EmptyLibrary" });
  const shuffledLibrary = shuffled(options.rng, deck.library);
  const hand = shuffledLibrary.slice(0, OPENING_HAND);
  const library = shuffledLibrary.slice(OPENING_HAND);
  const rules = getFormatRules(options.format);
  const freeMulligan = options.freeMulligan ?? rules.freeFirstMulligan;
  return ok({
    format: options.format,
    onTheDraw: options.onTheDraw ?? false,
    freeMulligan,
    kept: false,
    turn: 0,
    mulligans: 0,
    toBottom: 0,
    landsPlayedThisTurn: 0,
    commandCasts: 0,
    manaPool: { ...EMPTY_MANA_POOL },
    endStepQueue: [],
    library,
    hand,
    battlefield: [],
    graveyard: [],
    exile: [],
    commandZone: [...deck.commandZone],
    lastActionNote: `Dealt opening hand of ${hand.length} cards.`,
  });
}

export function peekLibrary(state: GoldfishState, count: number): readonly GoldfishCard[] {
  return state.library.slice(0, Math.max(0, count));
}

function isSpellOnlyType(typeLine: string): boolean {
  const lower = typeLine.toLowerCase();
  return (
    (lower.includes("instant") || lower.includes("sorcery")) &&
    !lower.includes("creature") &&
    !lower.includes("artifact") &&
    !lower.includes("enchantment") &&
    !lower.includes("planeswalker") &&
    !lower.includes("battle") &&
    !lower.includes("land")
  );
}

function manaProducedOnTap(permanent: BattlefieldPermanent, state: GoldfishState): ManaPool {
  const isCreature = /\bCreature\b/i.test(permanent.card.typeLine);
  const hasHaste = permanentHasKeyword(permanent, "haste", state);
  if (isCreature && permanent.enteredTurn === state.turn && !hasHaste) {
    return { ...EMPTY_MANA_POOL };
  }
  return extractTapManaProduction(permanent.card, state.battlefield);
}

export type StepGoldfishOptions = SimulationPipeline & Readonly<{ formatRules?: FormatRuleSet }>;

export function stepGoldfishState(
  state: GoldfishState,
  action: GoldfishAction,
  options: StepGoldfishOptions = {},
): Result<GoldfishState, GoldfishError> {
  const castModifiers = options.castModifiers ?? DEFAULT_CAST_MODIFIERS;
  const zonePermissions = options.zonePermissions ?? DEFAULT_ZONE_PERMISSIONS;
  const replacementEffects = options.replacementEffects ?? DEFAULT_REPLACEMENT_EFFECTS;
  const zoneReplacements = options.zoneReplacements ?? [];
  const triggerHandlers = options.triggerHandlers ?? DEFAULT_TRIGGER_HANDLERS;
  const activatedAbilities = options.activatedAbilities ?? DEFAULT_ACTIVATED_ABILITIES;
  const formatRules = options.formatRules ?? getFormatRules(state.format);

  switch (action.kind) {
    case "mulligan": {
      if (state.turn > 0 || state.kept) {
        return err({
          kind: "MulliganNotAllowed",
          reason: "Cannot mulligan after keeping or starting turn 1.",
        });
      }
      if (state.toBottom > 0) {
        return err({
          kind: "MulliganNotAllowed",
          reason: `Finish bottoming ${state.toBottom} card(s) before mulliganing again.`,
        });
      }
      const nextMulligans = state.mulligans + 1;
      const toBottom = Math.max(0, nextMulligans - (state.freeMulligan ? 1 : 0));
      const pool = shuffled(action.rng, [...state.hand, ...state.library]);
      const hand = pool.slice(0, OPENING_HAND);
      const library = pool.slice(OPENING_HAND);
      return ok({
        ...state,
        library,
        hand,
        mulligans: nextMulligans,
        toBottom: Math.min(hand.length, toBottom),
        lastActionNote: `Mulligan #${nextMulligans}: drew ${hand.length}${toBottom > 0 ? `, bottom ${toBottom}` : " (free)"}.`,
      });
    }

    case "bottom": {
      if (action.keys.length !== state.toBottom) {
        return err({
          kind: "InvalidBottomSelection",
          expected: state.toBottom,
          received: action.keys.length,
        });
      }
      const uniqueKeys = new Set(action.keys);
      if (uniqueKeys.size !== action.keys.length) {
        return err({
          kind: "InvalidBottomSelection",
          expected: state.toBottom,
          received: uniqueKeys.size,
        });
      }
      let next = state;
      const bottomed: string[] = [];
      for (const key of action.keys) {
        const removed = removeCardFromZone(next, "hand", key);
        if (!removed) return err({ kind: "CardNotFound", key, zone: "hand" });
        next = addCardToZone(removed.next, "library_bottom", removed.card);
        bottomed.push(removed.card.name);
      }
      return ok({
        ...next,
        toBottom: 0,
        lastActionNote: bottomed.length > 0 ? `Bottomed ${bottomed.join(", ")}.` : "Kept hand.",
      });
    }

    case "keep": {
      if (state.toBottom > 0) return err({ kind: "PendingBottom", remaining: state.toBottom });
      return ok({
        ...state,
        kept: true,
        lastActionNote: `Kept opening hand of ${state.hand.length} cards.`,
      });
    }

    case "next_turn": {
      if (state.toBottom > 0) return err({ kind: "PendingBottom", remaining: state.toBottom });
      const nextTurn = state.turn + 1;
      const shouldDraw = nextTurn > 1 || state.onTheDraw;
      const untapped = state.battlefield.map((p) => ({ ...p, tapped: false }));
      let hand = state.hand;
      let library = state.library;
      let drawNote = "skipped turn-1 draw (on the play)";
      if (shouldDraw) {
        if (library.length > 0) {
          const [top, ...rest] = library;
          hand = [...hand, top];
          library = rest;
          drawNote = `drew ${top.name}`;
        } else {
          drawNote = "library empty";
        }
      }
      return ok({
        ...state,
        kept: true,
        turn: nextTurn,
        phase: "main",
        landsPlayedThisTurn: 0,
        turnUsage: {},
        spellsCastThisTurn: 0,
        manaPool: { ...EMPTY_MANA_POOL },
        battlefield: untapped,
        hand,
        library,
        lastActionNote: `Turn ${nextTurn}: untapped, ${drawNote}.`,
      });
    }

    case "end_step": {
      const baseState: GoldfishState = {
        ...state,
        phase: "end_step",
        manaPool: { ...EMPTY_MANA_POOL },
      };
      const dispatched = dispatchGameEvents(
        baseState,
        [{ kind: "PhaseEnded", phase: "end_step" }],
        triggerHandlers,
      );
      const note =
        dispatched.notes.length > 0
          ? `End step: ${dispatched.notes.join("; ")}.`
          : "End step: emptied mana pool.";
      return ok({ ...dispatched.state, lastActionNote: note });
    }

    case "draw": {
      if (state.toBottom > 0) return err({ kind: "PendingBottom", remaining: state.toBottom });
      const count = Math.max(1, action.count ?? 1);
      const drawn = state.library.slice(0, count);
      const library = state.library.slice(drawn.length);
      return ok({
        ...state,
        hand: [...state.hand, ...drawn],
        library,
        lastActionNote:
          drawn.length > 0
            ? `Drew ${drawn.map((c) => c.name).join(", ")}.`
            : "Library is empty; drew 0 cards.",
      });
    }

    case "play_land": {
      if (state.toBottom > 0) return err({ kind: "PendingBottom", remaining: state.toBottom });
      if (!state.kept || state.turn === 0) {
        return err({
          kind: "CastNotAllowed",
          reason: "Must keep hand and advance to turn 1 before playing a land.",
        });
      }
      if (state.landsPlayedThisTurn >= allowedLandDropsThisTurn(state) && !action.ignoreLandLimit) {
        return err({ kind: "LandLimitReached", landsPlayedThisTurn: state.landsPlayedThisTurn });
      }
      const removed = removeCardFromZone(state, "hand", action.key);
      if (!removed) return err({ kind: "CardNotFound", key: action.key, zone: "hand" });
      if (!removed.card.isLand) {
        return err({ kind: "NotALand", key: action.key, name: removed.card.name });
      }
      const next = addCardToZone(removed.next, "battlefield", removed.card, {
        tapped: action.tapped ?? false,
        from: "hand",
        replacementEffects,
      });
      const entered = next.battlefield[next.battlefield.length - 1];
      const dispatched = dispatchGameEvents(
        {
          ...next,
          landsPlayedThisTurn: state.landsPlayedThisTurn + 1,
        },
        [
          { kind: "ZoneChanged", card: removed.card, from: "hand", to: "battlefield" },
          ...(entered ? [{ kind: "PermanentEntered" as const, permanent: entered }] : []),
        ],
        triggerHandlers,
      );
      return ok({
        ...dispatched.state,
        lastActionNote: `Played land ${removed.card.name}${action.tapped ? " (tapped)" : ""}.`,
      });
    }

    case "cast": {
      if (state.toBottom > 0) return err({ kind: "PendingBottom", remaining: state.toBottom });
      if (!state.kept || state.turn === 0) {
        return err({
          kind: "CastNotAllowed",
          reason: "Must keep hand and advance to turn 1 before casting spells.",
        });
      }
      const from = action.from ?? "hand";
      const removed = removeCardFromZone(state, from, action.key);
      if (!removed) return err({ kind: "CardNotFound", key: action.key, zone: from });

      const usageIncrements: string[] = [];
      for (const perm of zonePermissions) {
        if (!perm.applies({ state, card: removed.card, from })) continue;
        const pRes = perm.check({ state, card: removed.card, from });
        if (!pRes.allowed) {
          return err({
            kind: "CastNotAllowed",
            reason: pRes.reason ?? `Cannot cast ${removed.card.name} from ${from}.`,
          });
        }
        if (pRes.usageKey) usageIncrements.push(pRes.usageKey);
      }
      if (
        from === "library" &&
        !zonePermissions.some((p) => p.applies({ state, card: removed.card, from }))
      ) {
        return err({
          kind: "CastNotAllowed",
          reason: `No permission active to cast ${removed.card.name} from library.`,
        });
      }

      const modCtx = {
        state,
        card: removed.card,
        from,
        alt: action.alt,
        explicitReductionGeneric: action.costReductionGeneric,
        formatRules,
      };

      // CR 601.2f strict cost order: base/alt -> increase (tax) -> reduction -> minimum (e.g. Trinisphere)
      const phaseOrder: Record<string, number> = {
        base: 0,
        increase: 1,
        reduction: 2,
        minimum: 3,
      };
      const orderedModifiers = [...castModifiers].sort(
        (a, b) =>
          (phaseOrder[a.phase ?? "increase"] ?? 1) - (phaseOrder[b.phase ?? "increase"] ?? 1),
      );

      let genericDelta = 0;
      let minimumTotalCost = 0;
      const grantAbilities: string[] = [];
      const enqueueTriggers: EndStepTrigger[] = [];
      const taxLabels: string[] = [];

      for (const modifier of orderedModifiers) {
        if (!modifier.applies(modCtx)) continue;
        const res = modifier.apply(modCtx);
        if (!res.allowed) {
          return err({
            kind: "CastNotAllowed",
            reason: res.reason ?? `Cast blocked by modifier ${modifier.id}.`,
          });
        }
        if (res.genericDelta) genericDelta += res.genericDelta;
        if (res.minimumTotalCost !== undefined) {
          minimumTotalCost = Math.max(minimumTotalCost, res.minimumTotalCost);
        }
        if (res.grantAbilities) grantAbilities.push(...res.grantAbilities);
        if (res.enqueueTriggers) enqueueTriggers.push(...res.enqueueTriggers);
        if (res.taxLabel) taxLabels.push(res.taxLabel);
      }

      const baseCost = parseManaCost(removed.card.manaCost, removed.card.manaValue ?? 0);
      let genericCost = Math.max(0, baseCost.generic + genericDelta);
      if (minimumTotalCost > 0) {
        const pipCount =
          Object.values(baseCost.pips).reduce((a, b) => a + b, 0) + baseCost.hybridPips.length;
        genericCost = Math.max(genericCost, minimumTotalCost - pipCount);
      }
      const totalCost: ParsedManaCost = {
        pips: baseCost.pips,
        hybridPips: baseCost.hybridPips,
        phyrexianPips: baseCost.phyrexianPips,
        generic: genericCost,
      };

      const strict = action.strict ?? true;
      const spentPool = spendMana(state.manaPool, totalCost);
      if (strict && spentPool === null) {
        const suffix = taxLabels.length > 0 ? ` + ${taxLabels.join(" + ")}` : "";
        return err({
          kind: "InsufficientMana",
          card: removed.card.name,
          required: `${removed.card.manaCost ?? totalCost.generic}${suffix}`,
          available: state.manaPool,
        });
      }

      const destination =
        action.to ?? (isSpellOnlyType(removed.card.typeLine) ? "graveyard" : "battlefield");
      const next = addCardToZone(removed.next, destination, removed.card, {
        tapped: action.tapped ?? false,
        abilities: grantAbilities,
        from,
        replacementEffects,
      });

      const nextEndStepQueue =
        destination === "battlefield" && enqueueTriggers.length > 0
          ? [...next.endStepQueue, ...enqueueTriggers]
          : next.endStepQueue;

      const nextTurnUsage: Record<string, number> = { ...(next.turnUsage ?? {}) };
      for (const key of usageIncrements) {
        nextTurnUsage[key] = (nextTurnUsage[key] ?? 0) + 1;
      }
      const nextCommandCastsByKey: Record<string, number> = { ...(next.commandCastsByKey ?? {}) };
      if (from === "commandZone") {
        nextCommandCastsByKey[removed.card.key] =
          (nextCommandCastsByKey[removed.card.key] ?? 0) + 1;
      }

      const updatedState: GoldfishState = {
        ...next,
        manaPool: spentPool ?? next.manaPool,
        commandCasts: from === "commandZone" ? next.commandCasts + 1 : next.commandCasts,
        commandCastsByKey: nextCommandCastsByKey,
        turnUsage: nextTurnUsage,
        spellsCastThisTurn: (next.spellsCastThisTurn ?? 0) + 1,
        endStepQueue: nextEndStepQueue,
      };

      const entered =
        destination === "battlefield"
          ? updatedState.battlefield[updatedState.battlefield.length - 1]
          : undefined;

      const dispatched = dispatchGameEvents(
        updatedState,
        [
          {
            kind: "SpellCast",
            card: removed.card,
            from,
            to: destination,
            ...(action.alt ? { alt: action.alt } : {}),
          },
          { kind: "ZoneChanged", card: removed.card, from, to: destination },
          ...(entered ? [{ kind: "PermanentEntered" as const, permanent: entered }] : []),
        ],
        triggerHandlers,
      );

      return ok({
        ...dispatched.state,
        lastActionNote: `Cast ${removed.card.name}${action.alt ? ` (${action.alt})` : ""} from ${from} → ${destination}.`,
      });
    }

    case "tap":
    case "untap": {
      const idx = state.battlefield.findIndex((p) => p.card.key === action.key);
      if (idx === -1) return err({ kind: "CardNotFound", key: action.key, zone: "battlefield" });
      const perm = state.battlefield[idx];
      const tapped = action.kind === "tap";
      const battlefield = state.battlefield.map((p, i) => (i === idx ? { ...p, tapped } : p));
      const added = tapped && !perm.tapped ? manaProducedOnTap(perm, state) : EMPTY_MANA_POOL;
      const manaPool = addMana(state.manaPool, added);
      const nextState: GoldfishState = { ...state, battlefield, manaPool };
      const dispatched =
        tapped && !perm.tapped
          ? dispatchGameEvents(
              nextState,
              [{ kind: "PermanentTapped", permanent: perm }],
              triggerHandlers,
            )
          : { state: nextState, notes: [] };
      return ok({
        ...dispatched.state,
        lastActionNote: `${tapped ? "Tapped" : "Untapped"} ${perm.card.name}.`,
      });
    }

    case "activate": {
      const source = state.battlefield.find((p) => p.card.key === action.key);
      if (!source) return err({ kind: "CardNotFound", key: action.key, zone: "battlefield" });
      const ability = activatedAbilities.find((a) => a.canActivate(source, state));
      if (!ability) {
        return err({
          kind: "CastNotAllowed",
          reason: `No registered activated ability matched for ${source.card.name}.`,
        });
      }
      const res = ability.activate({
        state,
        source,
        sacrificeKey: action.sacrificeKey,
        zoneReplacements,
      });
      if (!res.ok) return err({ kind: "CastNotAllowed", reason: res.reason });
      const dispatched = dispatchGameEvents(res.state, res.events, triggerHandlers);
      return ok({
        ...dispatched.state,
        lastActionNote: res.note,
      });
    }

    case "attach": {
      const att = state.battlefield.find((p) => p.card.key === action.key);
      if (!att) return err({ kind: "CardNotFound", key: action.key, zone: "battlefield" });
      const target = state.battlefield.find((p) => p.card.key === action.targetKey);
      if (!target) return err({ kind: "CardNotFound", key: action.targetKey, zone: "battlefield" });
      if (/\bEquipment\b/i.test(att.card.typeLine) && !/\bCreature\b/i.test(target.card.typeLine)) {
        return err({
          kind: "CastNotAllowed",
          reason: `Equipment ${att.card.name} can only attach to a creature (CR 301.5).`,
        });
      }
      const battlefield = state.battlefield.map((p) =>
        p.card.key === action.key ? { ...p, attachedTo: action.targetKey } : p,
      );
      return ok({
        ...state,
        battlefield,
        lastActionNote: `Attached ${att.card.name} to ${target.card.name}.`,
      });
    }

    case "mill": {
      const count = Math.max(1, action.count ?? 1);
      const milled = state.library.slice(0, count);
      const library = state.library.slice(milled.length);
      const graveyard = [...state.graveyard, ...milled];
      const events = milled.map((card) => ({
        kind: "ZoneChanged" as const,
        card,
        from: "library" as const,
        to: "graveyard" as const,
      }));
      const dispatched = dispatchGameEvents(
        { ...state, library, graveyard },
        events,
        triggerHandlers,
      );
      return ok({
        ...dispatched.state,
        lastActionNote:
          milled.length > 0
            ? `Milled ${milled.map((c) => c.name).join(", ")}.`
            : "Library is empty; milled 0 cards.",
      });
    }

    case "attack": {
      const keySet = new Set(action.keys);
      const attackers: BattlefieldPermanent[] = [];
      for (const key of keySet) {
        const perm = state.battlefield.find((p) => p.card.key === key);
        if (!perm) {
          return err({
            kind: "CastNotAllowed",
            reason: `Attacker ${key} not found on battlefield.`,
          });
        }
        if (perm.tapped) {
          return err({
            kind: "CastNotAllowed",
            reason: `${perm.card.name} is tapped and cannot attack.`,
          });
        }
        if (permanentHasKeyword(perm, "defender", state)) {
          return err({
            kind: "CastNotAllowed",
            reason: `${perm.card.name} has defender and cannot attack.`,
          });
        }
        if (perm.enteredTurn === state.turn && !permanentHasKeyword(perm, "haste", state)) {
          return err({
            kind: "CastNotAllowed",
            reason: `${perm.card.name} has summoning sickness and cannot attack this turn.`,
          });
        }
      }
      const battlefield = state.battlefield.map((p) => {
        if (!keySet.has(p.card.key)) return p;
        const abilities = Array.from(new Set([...(p.abilities ?? []), "attacking"]));
        const vigilant = permanentHasKeyword(p, "vigilance", state);
        const updated: BattlefieldPermanent = {
          ...p,
          tapped: vigilant ? p.tapped : true,
          abilities,
        };
        attackers.push(updated);
        return updated;
      });
      const opponentCount = Math.max(1, action.opponentCount ?? 3);
      const events = attackers.map((permanent) => ({
        kind: "CreatureAttacked" as const,
        permanent,
        opponentCount,
      }));
      const dispatched = dispatchGameEvents(
        { ...state, phase: "combat", battlefield },
        events,
        triggerHandlers,
      );
      return ok({
        ...dispatched.state,
        lastActionNote: `Attacked with ${attackers.map((a) => a.card.name).join(", ")}.`,
      });
    }

    case "end_combat": {
      const dispatched = dispatchGameEvents(
        { ...state, phase: "main" },
        [{ kind: "PhaseEnded", phase: "end_combat" }],
        triggerHandlers,
      );
      return ok({
        ...dispatched.state,
        lastActionNote:
          dispatched.notes.length > 0
            ? `End of combat: ${dispatched.notes.join("; ")}.`
            : "Ended combat.",
      });
    }

    case "move": {
      const removed = removeCardFromZone(state, action.from, action.key);
      if (!removed) return err({ kind: "CardNotFound", key: action.key, zone: action.from });
      let intent: ZoneChangeIntent = {
        card: removed.card,
        from: action.from,
        to: action.to,
        previousPermanent: removed.permanent,
      };
      for (const rep of zoneReplacements) {
        if (rep.applies(intent, removed.next)) {
          intent = rep.replace(intent, removed.next);
        }
      }
      const next = addCardToZone(removed.next, intent.to, removed.card, {
        from: action.from,
        replacementEffects,
      });
      const toZone: GoldfishZone =
        intent.to === "library_top" || intent.to === "library_bottom" ? "library" : intent.to;
      const dispatched = dispatchGameEvents(
        next,
        [
          {
            kind: "ZoneChanged",
            card: removed.card,
            from: action.from,
            to: toZone,
            previousPermanent: removed.permanent,
          },
        ],
        triggerHandlers,
      );
      return ok({
        ...dispatched.state,
        lastActionNote: `Moved ${removed.card.name} from ${action.from} → ${toZone}.`,
      });
    }

    case "shuffle_library": {
      const library = shuffled(action.rng, state.library);
      return ok({
        ...state,
        library,
        lastActionNote: `Shuffled library (${library.length} cards).`,
      });
    }
  }
}
