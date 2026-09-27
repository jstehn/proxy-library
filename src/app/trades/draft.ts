// A trade being put together, kept in the URL (design doc 10, section 9): nothing is stored until
// you propose it. Cards are written "printingId~finish~quantity", separated by commas.

export type DraftCard = {
  printingId: string;
  finish: "nonfoil" | "foil" | "etched";
  quantity: number;
};

export type Draft = {
  withUserId: string | null;
  give: DraftCard[]; // from you
  get: DraftCard[]; // from them
  giveMoney: string; // dollars as typed, e.g. "2.50"
  getMoney: string;
  replaces: string | null; // the trade this counters, if any
  mine: string; // search text for your cards
  theirs: string; // search text for their cards
};

const FINISHES = ["nonfoil", "foil", "etched"] as const;

function parseCards(raw: string | undefined): DraftCard[] {
  if (!raw) return [];
  return raw.split(",").flatMap((part) => {
    const [printingId, finish, quantity] = part.split("~");
    const knownFinish = FINISHES.find((option) => option === finish);
    const count = Number(quantity);
    if (
      !printingId ||
      knownFinish === undefined ||
      !Number.isInteger(count) ||
      count < 1 ||
      count > 99
    )
      return [];
    return [{ printingId, finish: knownFinish, quantity: count }];
  });
}

const text = (value: string | string[] | undefined) => (typeof value === "string" ? value : "");

export function readDraft(params: Record<string, string | string[] | undefined>): Draft {
  return {
    withUserId: text(params.with) || null,
    give: parseCards(text(params.give)),
    get: parseCards(text(params.get)),
    giveMoney: text(params.giveMoney),
    getMoney: text(params.getMoney),
    replaces: text(params.replaces) || null,
    mine: text(params.mine),
    theirs: text(params.theirs),
  };
}

function writeCards(cards: readonly DraftCard[]): string {
  return cards.map((card) => `${card.printingId}~${card.finish}~${card.quantity}`).join(",");
}

/** The URL for a draft, leaving out empty parts. */
export function draftHref(draft: Draft): string {
  const params = new URLSearchParams();
  if (draft.withUserId) params.set("with", draft.withUserId);
  if (draft.give.length > 0) params.set("give", writeCards(draft.give));
  if (draft.get.length > 0) params.set("get", writeCards(draft.get));
  if (draft.giveMoney) params.set("giveMoney", draft.giveMoney);
  if (draft.getMoney) params.set("getMoney", draft.getMoney);
  if (draft.replaces) params.set("replaces", draft.replaces);
  if (draft.mine) params.set("mine", draft.mine);
  if (draft.theirs) params.set("theirs", draft.theirs);
  return `/trades/new?${params.toString()}`;
}

/** The same list with one card's quantity changed by `delta` (removed at 0). */
export function adjust(
  cards: readonly DraftCard[],
  card: Omit<DraftCard, "quantity">,
  delta: number,
): DraftCard[] {
  const same = (other: DraftCard) =>
    other.printingId === card.printingId && other.finish === card.finish;
  const current = cards.find(same)?.quantity ?? 0;
  const quantity = Math.min(99, current + delta);
  const others = cards.filter((other) => !same(other));
  return quantity <= 0 ? others : [...others, { ...card, quantity }];
}
