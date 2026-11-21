"use server";
import { z } from "zod";
import { PrintingId } from "@/modules/catalog";
import {
  TradeId,
  describeDecideTradeError,
  describeProposeTradeError,
  type TradeItem,
} from "@/modules/trades";
import { Cents, UserId } from "@/shared/kernel";
import { formRedirect } from "@/server/form-action-instance";
import { draftHref, readDraft, type Draft } from "./draft";
import { NEW_TRADE_PATH, revalidateTrades, TRADES_PATH, tradePath } from "./paths";

/** The draft's items, from the proposer's point of view (you are the proposer). */
function itemsOf(draft: Draft): TradeItem[] | null {
  const money = (raw: string, from: TradeItem["from"]): TradeItem[] | null => {
    if (raw.trim() === "") return [];
    const amount = Cents.fromUsd(raw);
    return amount === null ? null : [{ kind: "money", from, amount }];
  };
  const giveMoney = money(draft.giveMoney, "proposer");
  const getMoney = money(draft.getMoney, "recipient");
  if (giveMoney === null || getMoney === null) return null;
  const cards = (list: Draft["give"], from: TradeItem["from"]): TradeItem[] =>
    list.map((card) => ({
      kind: "card",
      from,
      printingId: PrintingId.of(card.printingId),
      finish: card.finish,
      quantity: card.quantity,
    }));
  return [
    ...cards(draft.give, "proposer"),
    ...giveMoney,
    ...cards(draft.get, "recipient"),
    ...getMoney,
  ];
}

/**
 * The trade builder's whole draft travels in the form (the page's address, copied in just before
 * it is sent), next to the message.
 */
const ProposeForm = z.object({
  with: z.string().default(""),
  give: z.string().default(""),
  get: z.string().default(""),
  giveMoney: z.string().default(""),
  getMoney: z.string().default(""),
  replaces: z.string().default(""),
  mine: z.string().default(""),
  theirs: z.string().default(""),
  message: z.string().default(""),
});

/** Sends the draft as a proposal, or as a counter-offer when it replaces a trade. */
export const proposeTradeAction = formRedirect(
  ProposeForm,
  async ({ actor, capabilities }, input) => {
    const draft = readDraft(input);
    const back = (message: string) => `${draftHref(draft)}&error=${encodeURIComponent(message)}`;
    if (draft.withUserId === null) return NEW_TRADE_PATH;
    const items = itemsOf(draft);
    if (items === null) return back("Enter money like 2.50.");

    const { trades } = capabilities;
    const result =
      draft.replaces === null
        ? await trades.proposeTrade(actor, {
            recipientId: UserId.of(draft.withUserId),
            items,
            message: input.message,
          })
        : await trades.counterTrade(actor, TradeId.of(Number(draft.replaces)), {
            items,
            message: input.message,
          });
    if (!result.ok) return back(describeProposeTradeError(result.error));
    revalidateTrades();
    return tradePath(result.value);
  },
);

/** Accept, decline or cancel. */
export const decideTradeAction = formRedirect(
  z.object({ tradeId: z.coerce.number().int().positive(), decision: z.string().default("") }),
  async ({ actor, capabilities }, { tradeId: rawTradeId, decision }) => {
    const tradeId = TradeId.of(rawTradeId);
    const { trades } = capabilities;
    const result =
      decision === "accept"
        ? await trades.acceptTrade(actor, tradeId)
        : decision === "decline"
          ? await trades.declineTrade(actor, tradeId)
          : await trades.cancelTrade(actor, tradeId);
    revalidateTrades(rawTradeId);
    if (!result.ok) return tradePath(rawTradeId, describeDecideTradeError(result.error));
    return tradePath(rawTradeId);
  },
  { unreadable: TRADES_PATH },
);
