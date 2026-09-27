import type { TradeItemView, TradeView } from "@/modules/trades";
import { Cents } from "@/shared/kernel";

// Shared bits for showing a trade.

const FINISH = { nonfoil: "", foil: " (foil)", etched: " (etched)" };

/** "2 × Lightning Bolt (foil)" or "$2.50". */
export function itemText(item: TradeItemView): string {
  if (item.kind === "money") return Cents.format(Cents.of(item.amountCents ?? 0));
  return `${item.quantity} × ${item.name ?? "Unknown card"}${item.finish ? FINISH[item.finish] : ""}`;
}

/** Market value of one side's cards, plus its money. */
export function sideValue(items: readonly TradeItemView[]): Cents {
  return Cents.of(
    items.reduce(
      (total, item) =>
        total +
        (item.kind === "money"
          ? (item.amountCents ?? 0)
          : (item.priceCents ?? 0) * (item.quantity ?? 0)),
      0,
    ),
  );
}

export const STATUS_LABELS: Record<TradeView["status"], string> = {
  proposed: "waiting",
  accepted: "accepted",
  declined: "declined",
  cancelled: "cancelled",
  countered: "countered",
};
