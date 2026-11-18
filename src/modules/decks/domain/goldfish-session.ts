import { cardTags, type Tag } from "@/shared/card-search";
import { err, ok, shuffled, type Result, type Rng } from "@/shared/kernel";
import type { Board } from "./deck";
import { OPENING_HAND } from "./draws";
import { isLand } from "./stats";

// Interactive turn-by-turn tabletop goldfish state machine (design doc 60 + 61).
// Pure and deterministic via injected Rng (ADR 0008).

export type GoldfishZone =
  | "library"
  | "hand"
  | "battlefield"
  | "graveyard"
  | "exile"
  | "commandZone";

export type ManaColor = "W" | "U" | "B" | "R" | "G" | "C";
export type ManaPool = Record<ManaColor, number>;

export const EMPTY_MANA_POOL: ManaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

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
  tags: readonly Tag[];
}>;

export type BattlefieldPermanent = Readonly<{
  card: GoldfishCard;
  tapped: boolean;
  enteredTurn: number;
  haste?: boolean;
  blitzed?: boolean;
}>;

export type EndStepTrigger = Readonly<{
  key: string;
  kind: "sacrifice_blitz";
}>;

export type GoldfishState = Readonly<{
  format: string;
  onTheDraw: boolean;
  freeMulligan: boolean;
  kept: boolean;
  turn: number;
  mulligans: number;
  toBottom: number;
  landsPlayedThisTurn: number;
  commandCasts: number;
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
      from?: "hand" | "commandZone" | "graveyard" | "exile";
      to?: "battlefield" | "graveyard" | "exile";
      tapped?: boolean;
      alt?: "blitz";
      strict?: boolean;
      costReductionGeneric?: number;
    }>
  | Readonly<{ kind: "tap"; key: string }>
  | Readonly<{ kind: "untap"; key: string }>
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
  const freeMulligan = options.freeMulligan ?? options.format === "commander";
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

function removeFromZone(
  state: GoldfishState,
  zone: GoldfishZone,
  key: string,
): { card: GoldfishCard; next: GoldfishState } | null {
  if (zone === "battlefield") {
    const idx = state.battlefield.findIndex((p) => p.card.key === key);
    if (idx === -1) return null;
    const card = state.battlefield[idx].card;
    const battlefield = state.battlefield.filter((_, i) => i !== idx);
    return { card, next: { ...state, battlefield } };
  }
  const list = state[zone];
  const idx = list.findIndex((c) => c.key === key);
  if (idx === -1) return null;
  const card = list[idx];
  const updated = list.filter((_, i) => i !== idx);
  return { card, next: { ...state, [zone]: updated } };
}

function addToZone(
  state: GoldfishState,
  to: Exclude<GoldfishZone, "library"> | "library_top" | "library_bottom",
  card: GoldfishCard,
  opts: { tapped?: boolean; haste?: boolean; blitzed?: boolean } = {},
): GoldfishState {
  switch (to) {
    case "hand":
      return { ...state, hand: [...state.hand, card] };
    case "battlefield":
      return {
        ...state,
        battlefield: [
          ...state.battlefield,
          {
            card,
            tapped: opts.tapped ?? false,
            enteredTurn: state.turn,
            ...(opts.haste ? { haste: true } : {}),
            ...(opts.blitzed ? { blitzed: true } : {}),
          },
        ],
      };
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

interface ParsedManaCost {
  pips: ManaPool;
  generic: number;
}

function parseManaCost(manaCost: string | null | undefined, fallbackMv = 0): ParsedManaCost {
  if (!manaCost) {
    return { pips: { ...EMPTY_MANA_POOL }, generic: Math.max(0, fallbackMv) };
  }
  const pips: ManaPool = { ...EMPTY_MANA_POOL };
  let generic = 0;
  const symbols = manaCost.match(/\{([^}]+)\}/g) ?? [];
  for (const raw of symbols) {
    const sym = raw.slice(1, -1).toUpperCase();
    if (/^\d+$/.test(sym)) {
      generic += Number(sym);
    } else if (sym === "W" || sym === "U" || sym === "B" || sym === "R" || sym === "G" || sym === "C") {
      pips[sym] += 1;
    } else if (sym === "X") {
      // X=0 for base cost check
    } else if (sym.includes("/")) {
      // Hybrid or Phyrexian: treat first colored symbol if present, else generic 1
      const first = sym.split("/")[0];
      if (first === "W" || first === "U" || first === "B" || first === "R" || first === "G") {
        pips[first] += 1;
      } else {
        generic += 1;
      }
    }
  }
  return { pips, generic };
}

function spendMana(pool: ManaPool, cost: ParsedManaCost): ManaPool | null {
  const next: ManaPool = { ...pool };
  const colors: ManaColor[] = ["W", "U", "B", "R", "G", "C"];
  for (const c of colors) {
    if (next[c] < cost.pips[c]) return null;
    next[c] -= cost.pips[c];
  }
  let rem = cost.generic;
  // Spend colorless first, then colored mana
  for (const c of ["C", "W", "U", "B", "R", "G"] as const) {
    if (rem <= 0) break;
    const take = Math.min(next[c], rem);
    next[c] -= take;
    rem -= take;
  }
  return rem === 0 ? next : null;
}

function manaProducedOnTap(permanent: BattlefieldPermanent, currentTurn: number): ManaPool {
  const isCreature = /\bCreature\b/i.test(permanent.card.typeLine);
  if (isCreature && permanent.enteredTurn === currentTurn && !permanent.haste) {
    return { ...EMPTY_MANA_POOL };
  }
  const added: ManaPool = { ...EMPTY_MANA_POOL };
  const text = permanent.card.text ?? "";
  // Check explicit "{T}: Add {C}{C}" style patterns first
  const tapAddMatch = text.match(/\{T\}[^.]*Add\s+((?:\{[WUBRGC]\})+)/i);
  if (tapAddMatch) {
    const syms = tapAddMatch[1].match(/\{([WUBRGC])\}/gi) ?? [];
    for (const s of syms) {
      const c = s.slice(1, -1).toUpperCase() as ManaColor;
      added[c] += 1;
    }
    return added;
  }
  if (permanent.card.producedMana && permanent.card.producedMana.length > 0) {
    const first = permanent.card.producedMana[0].toUpperCase();
    if (first === "W" || first === "U" || first === "B" || first === "R" || first === "G" || first === "C") {
      added[first] += 1;
      return added;
    }
  }
  if (permanent.card.isLand) {
    const tl = permanent.card.typeLine;
    if (tl.includes("Plains")) added.W += 1;
    else if (tl.includes("Island")) added.U += 1;
    else if (tl.includes("Swamp")) added.B += 1;
    else if (tl.includes("Mountain")) added.R += 1;
    else if (tl.includes("Forest")) added.G += 1;
    else added.C += 1;
  }
  return added;
}

function addMana(pool: ManaPool, delta: ManaPool): ManaPool {
  return {
    W: pool.W + delta.W,
    U: pool.U + delta.U,
    B: pool.B + delta.B,
    R: pool.R + delta.R,
    G: pool.G + delta.G,
    C: pool.C + delta.C,
  };
}

export function stepGoldfishState(
  state: GoldfishState,
  action: GoldfishAction,
): Result<GoldfishState, GoldfishError> {
  switch (action.kind) {
    case "mulligan": {
      if (state.turn > 0 || state.kept) {
        return err({ kind: "MulliganNotAllowed", reason: "Cannot mulligan after keeping or starting turn 1." });
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
        const removed = removeFromZone(next, "hand", key);
        if (!removed) return err({ kind: "CardNotFound", key, zone: "hand" });
        next = addToZone(removed.next, "library_bottom", removed.card);
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
        landsPlayedThisTurn: 0,
        manaPool: { ...EMPTY_MANA_POOL },
        battlefield: untapped,
        hand,
        library,
        lastActionNote: `Turn ${nextTurn}: untapped, ${drawNote}.`,
      });
    }

    case "end_step": {
      let next: GoldfishState = { ...state, manaPool: { ...EMPTY_MANA_POOL } };
      const sacrificed: string[] = [];
      let drawn = 0;
      for (const trigger of state.endStepQueue) {
        if (trigger.kind !== "sacrifice_blitz") continue;
        const removed = removeFromZone(next, "battlefield", trigger.key);
        if (!removed) continue;
        next = addToZone(removed.next, "graveyard", removed.card);
        sacrificed.push(removed.card.name);
        if (next.library.length > 0) {
          const [top, ...rest] = next.library;
          next = { ...next, hand: [...next.hand, top], library: rest };
          drawn += 1;
        }
      }
      next = { ...next, endStepQueue: [] };
      const note =
        sacrificed.length > 0
          ? `End step: sacrificed ${sacrificed.join(", ")} (blitz) and drew ${drawn} card(s).`
          : "End step: emptied mana pool.";
      return ok({ ...next, lastActionNote: note });
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
      if (state.landsPlayedThisTurn >= 1 && !action.ignoreLandLimit) {
        return err({ kind: "LandLimitReached", landsPlayedThisTurn: state.landsPlayedThisTurn });
      }
      const removed = removeFromZone(state, "hand", action.key);
      if (!removed) return err({ kind: "CardNotFound", key: action.key, zone: "hand" });
      if (!removed.card.isLand) {
        return err({ kind: "NotALand", key: action.key, name: removed.card.name });
      }
      const next = addToZone(removed.next, "battlefield", removed.card, {
        tapped: action.tapped ?? false,
      });
      return ok({
        ...next,
        landsPlayedThisTurn: state.landsPlayedThisTurn + 1,
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
      const removed = removeFromZone(state, from, action.key);
      if (!removed) return err({ kind: "CardNotFound", key: action.key, zone: from });

      const baseCost = parseManaCost(removed.card.manaCost, removed.card.manaValue ?? 0);
      const commanderTax = from === "commandZone" ? state.commandCasts * 2 : 0;
      const reduction = Math.max(0, action.costReductionGeneric ?? 0);
      const totalCost: ParsedManaCost = {
        pips: baseCost.pips,
        generic: Math.max(0, baseCost.generic + commanderTax - reduction),
      };

      const strict = action.strict ?? true;
      const spentPool = spendMana(state.manaPool, totalCost);
      if (strict && spentPool === null) {
        return err({
          kind: "InsufficientMana",
          card: removed.card.name,
          required: `${removed.card.manaCost ?? totalCost.generic}${commanderTax > 0 ? ` + {${commanderTax}} tax` : ""}`,
          available: state.manaPool,
        });
      }

      const destination =
        action.to ?? (isSpellOnlyType(removed.card.typeLine) ? "graveyard" : "battlefield");
      const isBlitz = action.alt === "blitz";
      const next = addToZone(removed.next, destination, removed.card, {
        tapped: action.tapped ?? false,
        haste: isBlitz,
        blitzed: isBlitz,
      });
      const nextEndStepQueue =
        isBlitz && destination === "battlefield"
          ? [...next.endStepQueue, { key: removed.card.key, kind: "sacrifice_blitz" as const }]
          : next.endStepQueue;

      return ok({
        ...next,
        manaPool: spentPool ?? next.manaPool,
        commandCasts: from === "commandZone" ? next.commandCasts + 1 : next.commandCasts,
        endStepQueue: nextEndStepQueue,
        lastActionNote: `Cast ${removed.card.name}${isBlitz ? " (blitz)" : ""} from ${from} → ${destination}.`,
      });
    }

    case "tap":
    case "untap": {
      const idx = state.battlefield.findIndex((p) => p.card.key === action.key);
      if (idx === -1) return err({ kind: "CardNotFound", key: action.key, zone: "battlefield" });
      const perm = state.battlefield[idx];
      const tapped = action.kind === "tap";
      const battlefield = state.battlefield.map((p, i) => (i === idx ? { ...p, tapped } : p));
      const added = tapped && !perm.tapped ? manaProducedOnTap(perm, state.turn) : EMPTY_MANA_POOL;
      const manaPool = addMana(state.manaPool, added);
      return ok({
        ...state,
        battlefield,
        manaPool,
        lastActionNote: `${tapped ? "Tapped" : "Untapped"} ${perm.card.name}.`,
      });
    }

    case "move": {
      const removed = removeFromZone(state, action.from, action.key);
      if (!removed) return err({ kind: "CardNotFound", key: action.key, zone: action.from });
      const next = addToZone(removed.next, action.to, removed.card);
      return ok({
        ...next,
        lastActionNote: `Moved ${removed.card.name} from ${action.from} → ${action.to}.`,
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
