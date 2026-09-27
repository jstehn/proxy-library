import type { Finish, PrintingId } from "@/modules/catalog";
import { Cents, err, ok, type Brand, type Result, type UserId } from "@/shared/kernel";
import type { AlreadyDecided, OfferInvalid, TradeNotFound } from "./errors";

// The trades vocabulary and its state machine (design doc 10, sections 3–5).

export type TradeId = Brand<number, "TradeId">;
export const TradeId = {
  of(raw: number): TradeId {
    if (!Number.isSafeInteger(raw) || raw <= 0) throw new RangeError(`not a trade id: ${raw}`);
    return raw as TradeId;
  },
};

/** Who gives an item. */
export type TradeSide = "proposer" | "recipient";

export type TradeItem =
  | Readonly<{
      kind: "card";
      from: TradeSide;
      printingId: PrintingId;
      finish: Finish;
      quantity: number;
    }>
  | Readonly<{ kind: "money"; from: TradeSide; amount: Cents }>;

export type TradeStatus = "proposed" | "accepted" | "declined" | "cancelled" | "countered";

export type Trade = Readonly<{
  id: TradeId;
  proposerId: UserId;
  recipientId: UserId;
  status: TradeStatus;
  items: readonly TradeItem[];
  message: string;
  replacesId: TradeId | null;
  createdAt: Date;
  decidedAt: Date | null;
}>;

export const MAX_CARD_QUANTITY = 99;
export const MAX_MONEY = Cents.of(1_000_000); // $10,000
export const MAX_MESSAGE_LENGTH = 300;

/**
 * Checks and tidies an offer (rule 1): at least one item, whole quantities 1–99, money $0.01–$10,000,
 * at most one money item per side; the same card from the same side is combined into one item.
 */
export function checkOffer(items: readonly TradeItem[]): Result<TradeItem[], OfferInvalid> {
  if (items.length === 0)
    return err({ kind: "OfferInvalid", reason: "add at least one card or some money" });

  const cards = new Map<string, TradeItem & { kind: "card" }>();
  const money = new Map<TradeSide, TradeItem & { kind: "money" }>();
  for (const item of items) {
    if (item.kind === "money") {
      if (!Number.isInteger(item.amount) || item.amount < 1 || item.amount > MAX_MONEY) {
        return err({ kind: "OfferInvalid", reason: "money must be between $0.01 and $10,000" });
      }
      if (money.has(item.from))
        return err({ kind: "OfferInvalid", reason: "one amount of money per side" });
      money.set(item.from, item);
      continue;
    }
    const key = `${item.from}/${item.printingId}/${item.finish}`;
    const quantity = (cards.get(key)?.quantity ?? 0) + item.quantity;
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || quantity > MAX_CARD_QUANTITY) {
      return err({ kind: "OfferInvalid", reason: "card quantities must be 1 to 99" });
    }
    cards.set(key, { ...item, quantity });
  }
  return ok([...cards.values(), ...money.values()]);
}

/** A message is trimmed and at most 300 characters. */
export function checkMessage(raw: string): Result<string, OfferInvalid> {
  const message = raw.trim();
  if (message.length > MAX_MESSAGE_LENGTH) {
    return err({
      kind: "OfferInvalid",
      reason: `the message can be at most ${MAX_MESSAGE_LENGTH} characters`,
    });
  }
  return ok(message);
}

export type TradeEvent = "accept" | "decline" | "counter" | "cancel";

const OUTCOME: Record<TradeEvent, TradeStatus> = {
  accept: "accepted",
  decline: "declined",
  counter: "countered",
  cancel: "cancelled",
};

/** Who may send each event: the recipient decides; the proposer can only cancel (section 4). */
const ALLOWED: Record<TradeEvent, TradeSide> = {
  accept: "recipient",
  decline: "recipient",
  counter: "recipient",
  cancel: "proposer",
};

/** The actor's side in a trade, or null if they aren't part of it. */
export function sideOf(trade: Trade, userId: UserId): TradeSide | null {
  if (trade.proposerId === userId) return "proposer";
  if (trade.recipientId === userId) return "recipient";
  return null;
}

/**
 * The state machine (design doc 10, section 4). Someone outside the trade, or the wrong side,
 * gets TradeNotFound (the wrong side can't see a button for it anyway).
 */
export function decide(
  trade: Trade | null,
  userId: UserId,
  event: TradeEvent,
  now: Date,
): Result<Trade, TradeNotFound | AlreadyDecided> {
  if (trade === null || sideOf(trade, userId) !== ALLOWED[event])
    return err({ kind: "TradeNotFound" });
  if (trade.status !== "proposed") return err({ kind: "AlreadyDecided", status: trade.status });
  return ok({ ...trade, status: OUTCOME[event], decidedAt: now });
}
