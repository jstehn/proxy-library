"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { PrintingId } from "@/modules/catalog";
import {
  TradeId,
  type AcceptTradeError,
  type CounterTradeError,
  type Shortfall,
  type TradeItem,
} from "@/modules/trades";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { assertNever, Cents, UserId } from "@/shared/kernel";
import { draftHref, readDraft, type Draft } from "./draft";

function describeShortfall(shortfall: Shortfall): string {
  const who = shortfall.side === "proposer" ? "The proposer" : "The recipient";
  if (shortfall.what === "cards") {
    return `${who} has ${shortfall.owned} of a card the trade needs ${shortfall.needed} of.`;
  }
  return `${who} has ${Cents.format(shortfall.balance)}, and the trade needs ${Cents.format(shortfall.needed)}.`;
}

function proposeMessage(error: CounterTradeError): string {
  switch (error.kind) {
    case "CannotTradeWithYourself":
      return "You can't trade with yourself.";
    case "PlayerNotFound":
      return "That player can't trade right now.";
    case "OfferInvalid":
      return `The offer isn't valid: ${error.reason}.`;
    case "OfferNotPossible":
      return describeShortfall(error.shortfall);
    case "TradeNotFound":
      return "That trade isn't waiting for you.";
    case "AlreadyDecided":
      return `That trade was already ${error.status}.`;
    default:
      return assertNever(error);
  }
}

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

/** Sends the draft as a proposal, or as a counter-offer when it replaces a trade. */
export async function proposeTradeAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const draft = readDraft(
    Object.fromEntries([...formData.entries()].map(([key, value]) => [key, String(value)])),
  );
  const back = (message: string) =>
    redirect(`${draftHref(draft)}&error=${encodeURIComponent(message)}`);
  if (draft.withUserId === null) redirect("/trades/new");
  const items = itemsOf(draft);
  if (items === null) back("Enter money like 2.50.");
  const message = String(formData.get("message") ?? "");

  const { trades } = getContainer();
  const result =
    draft.replaces === null
      ? await trades.proposeTrade(actor, {
          recipientId: UserId.of(draft.withUserId),
          items: items ?? [],
          message,
        })
      : await trades.counterTrade(actor, TradeId.of(Number(draft.replaces)), {
          items: items ?? [],
          message,
        });
  if (!result.ok) back(proposeMessage(result.error));
  revalidatePath("/trades");
  revalidatePath("/", "layout"); // the badge
  redirect(`/trades/${result.ok ? result.value : ""}`);
}

function acceptMessage(error: AcceptTradeError): string {
  switch (error.kind) {
    case "TradeNotFound":
      return "That trade isn't yours to decide.";
    case "AlreadyDecided":
      return `That trade was already ${error.status}.`;
    case "NoLongerPossible":
      return `This trade can't happen any more. ${describeShortfall(error.shortfall)} Nothing was moved; decline it or counter.`;
    default:
      return assertNever(error);
  }
}

/** Accept, decline or cancel. */
export async function decideTradeAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const tradeId = TradeId.of(Number(formData.get("tradeId")));
  const decision = String(formData.get("decision"));
  const { trades } = getContainer();
  const result =
    decision === "accept"
      ? await trades.acceptTrade(actor, tradeId)
      : decision === "decline"
        ? await trades.declineTrade(actor, tradeId)
        : await trades.cancelTrade(actor, tradeId);
  revalidatePath("/trades");
  revalidatePath(`/trades/${tradeId}`);
  revalidatePath("/", "layout"); // the badge and the balance
  if (!result.ok)
    redirect(`/trades/${tradeId}?error=${encodeURIComponent(acceptMessage(result.error))}`);
  redirect(`/trades/${tradeId}`);
}
