import { cardTags, type Tag } from "@/shared/card-search";
import { err, ok, shuffled, type Result, type Rng } from "@/shared/kernel";
import type { Board } from "./deck";
import { OPENING_HAND } from "./draws";
import { isLand } from "./stats";

// Interactive turn-by-turn tabletop goldfish state machine (design doc 60).
// Pure and deterministic via injected Rng (ADR 0008).

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
  isLand: boolean;
  isCommander: boolean;
  tags: readonly Tag[];
}>;

export type BattlefieldPermanent = Readonly<{
  card: GoldfishCard;
  tapped: boolean;
  enteredTurn: number;
}>;

export type GoldfishState = Readonly<{
  format: string;
  onTheDraw: boolean;
  freeMulligan: boolean;
  turn: number;
  mulligans: number;
  toBottom: number;
  landsPlayedThisTurn: number;
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
  | Readonly<{ kind: "next_turn" }>
  | Readonly<{ kind: "draw"; count?: number }>
  | Readonly<{ kind: "play_land"; key: string; tapped?: boolean; ignoreLandLimit?: boolean }>
  | Readonly<{
      kind: "cast";
      key: string;
      from?: "hand" | "commandZone" | "graveyard" | "exile";
      to?: "battlefield" | "graveyard" | "exile";
      tapped?: boolean;
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
  for (const line of lines) {
    if (line.board !== "main" && line.board !== "commander") continue;
    const isCommander = line.board === "commander";
    const tags = cardTags({
      typeLine: line.typeLine,
      text: line.text ?? "",
      producedMana: line.producedMana,
    });
    for (let copy = 0; copy < line.quantity; copy++) {
      const card: GoldfishCard = {
        key: `${line.oracleId}#${isCommander ? "cmd" : copy + 1}`,
        oracleId: line.oracleId,
        name: line.name,
        printingId: line.printingId,
        typeLine: line.typeLine,
        ...(line.manaCost ? { manaCost: line.manaCost } : {}),
        ...(line.manaValue !== undefined ? { manaValue: line.manaValue } : {}),
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
    turn: 0,
    mulligans: 0,
    toBottom: 0,
    landsPlayedThisTurn: 0,
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
  tapped = false,
): GoldfishState {
  switch (to) {
    case "hand":
      return { ...state, hand: [...state.hand, card] };
    case "battlefield":
      return {
        ...state,
        battlefield: [...state.battlefield, { card, tapped, enteredTurn: state.turn }],
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

export function stepGoldfishState(
  state: GoldfishState,
  action: GoldfishAction,
): Result<GoldfishState, GoldfishError> {
  switch (action.kind) {
    case "mulligan": {
      if (state.turn > 0) {
        return err({ kind: "MulliganNotAllowed", reason: "Cannot mulligan after turn 1 starts." });
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
        turn: nextTurn,
        landsPlayedThisTurn: 0,
        battlefield: untapped,
        hand,
        library,
        lastActionNote: `Turn ${nextTurn}: untapped, ${drawNote}.`,
      });
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
      if (state.landsPlayedThisTurn >= 1 && !action.ignoreLandLimit) {
        return err({ kind: "LandLimitReached", landsPlayedThisTurn: state.landsPlayedThisTurn });
      }
      const removed = removeFromZone(state, "hand", action.key);
      if (!removed) return err({ kind: "CardNotFound", key: action.key, zone: "hand" });
      if (!removed.card.isLand) {
        return err({ kind: "NotALand", key: action.key, name: removed.card.name });
      }
      const next = addToZone(removed.next, "battlefield", removed.card, action.tapped ?? false);
      return ok({
        ...next,
        landsPlayedThisTurn: state.landsPlayedThisTurn + 1,
        lastActionNote: `Played land ${removed.card.name}${action.tapped ? " (tapped)" : ""}.`,
      });
    }

    case "cast": {
      if (state.toBottom > 0) return err({ kind: "PendingBottom", remaining: state.toBottom });
      const from = action.from ?? "hand";
      const removed = removeFromZone(state, from, action.key);
      if (!removed) return err({ kind: "CardNotFound", key: action.key, zone: from });
      const destination =
        action.to ?? (isSpellOnlyType(removed.card.typeLine) ? "graveyard" : "battlefield");
      const next = addToZone(removed.next, destination, removed.card, action.tapped ?? false);
      return ok({
        ...next,
        lastActionNote: `Cast ${removed.card.name} from ${from} → ${destination}.`,
      });
    }

    case "tap":
    case "untap": {
      const idx = state.battlefield.findIndex((p) => p.card.key === action.key);
      if (idx === -1) return err({ kind: "CardNotFound", key: action.key, zone: "battlefield" });
      const tapped = action.kind === "tap";
      const battlefield = state.battlefield.map((p, i) => (i === idx ? { ...p, tapped } : p));
      return ok({
        ...state,
        battlefield,
        lastActionNote: `${tapped ? "Tapped" : "Untapped"} ${state.battlefield[idx].card.name}.`,
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
