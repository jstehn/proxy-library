// The opening sequence as a state machine (design doc 08, section 3): a pure reducer, so every
// transition is unit-tested and the component only draws the current state.

/** One card as the opener shows it. The server decided it; the client only reveals it. */
export type OpenerCard = Readonly<{
  printingId: string;
  name: string;
  rarity: string;
  finish: "nonfoil" | "foil" | "etched";
  priceCents: number | null;
  hasImage: boolean;
  variantLabel: string;
}>;

export type OpenerPack = Readonly<{
  itemId: number;
  name: string;
  setCode: string;
  setName: string;
  keyruneCode: string;
  label: string; // "Play Booster Pack"
  featuredPrintingId: string | null;
  cards: readonly OpenerCard[]; // in reveal order (rule 1)
}>;

export type OpeningState =
  | Readonly<{ phase: "sealed"; pack: number }>
  | Readonly<{ phase: "tearing"; pack: number }>
  | Readonly<{ phase: "revealing"; pack: number; revealed: number }>
  | Readonly<{ phase: "summary"; pack: number }>
  | Readonly<{ phase: "finished" }>;

export type OpeningEvent =
  | Readonly<{ type: "tear" }>
  | Readonly<{ type: "tearFinished" }>
  | Readonly<{ type: "revealNext" }>
  | Readonly<{ type: "revealAll" }>
  | Readonly<{ type: "nextPack" }>
  | Readonly<{ type: "skipToEnd" }>;

export function initialState(packs: readonly OpenerPack[]): OpeningState {
  return packs.length === 0 ? { phase: "finished" } : { phase: "sealed", pack: 0 };
}

/**
 * The transition table. Events that don't apply to the current state change nothing, so a stray
 * click or key press can never skip ahead or go back.
 */
export function openingReducer(
  packs: readonly OpenerPack[],
  state: OpeningState,
  event: OpeningEvent,
): OpeningState {
  if (event.type === "skipToEnd") return { phase: "finished" };

  switch (state.phase) {
    case "sealed":
      return event.type === "tear" ? { phase: "tearing", pack: state.pack } : state;

    case "tearing":
      return event.type === "tearFinished"
        ? { phase: "revealing", pack: state.pack, revealed: 0 }
        : state;

    case "revealing": {
      const cardCount = packs[state.pack]?.cards.length ?? 0;
      if (event.type === "revealAll") return { phase: "summary", pack: state.pack };
      if (event.type !== "revealNext") return state;
      const revealed = state.revealed + 1;
      return revealed >= cardCount
        ? { phase: "summary", pack: state.pack }
        : { phase: "revealing", pack: state.pack, revealed };
    }

    case "summary":
      if (event.type !== "nextPack") return state;
      return state.pack + 1 < packs.length
        ? { phase: "sealed", pack: state.pack + 1 }
        : { phase: "finished" };

    case "finished":
      return state;
  }
}

/** How many of this pack's cards are face up in this state. */
export function revealedCount(state: OpeningState, pack: OpenerPack): number {
  if (state.phase === "revealing") return state.revealed;
  if (state.phase === "summary" || state.phase === "finished") return pack.cards.length;
  return 0;
}

export type HitLevel = "none" | "rare" | "mythic";

export const BIG_HIT_CENTS = 500; // any card worth $5 or more is treated like a mythic

/** How much fuss a card deserves when it's revealed (rule 3). */
export function hitLevel(card: OpenerCard): HitLevel {
  if (card.rarity === "mythic" || (card.priceCents ?? 0) >= BIG_HIT_CENTS) return "mythic";
  if (card.rarity === "rare" || card.rarity === "special" || card.rarity === "bonus") return "rare";
  return "none";
}

/** A pack's market value: the sum of its cards' prices (no price counts as $0). */
export function packValueCents(pack: OpenerPack): number {
  return pack.cards.reduce((total, card) => total + (card.priceCents ?? 0), 0);
}
