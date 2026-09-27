import Link from "next/link";
import type { FeedItem } from "@/modules/activity";
import { Cents } from "@/shared/kernel";
import { LocalTime } from "@/ui/local-time";

// The activity feed (design doc 11): notable pulls, sealed purchases and completed trades.

const RARITY_COLORS: Record<string, string> = {
  rare: "text-amber-600 dark:text-amber-400",
  mythic: "text-orange-600 dark:text-orange-400",
};

function Line(props: { item: FeedItem }) {
  const { item } = props;
  switch (item.kind) {
    case "pull":
      return (
        <>
          <strong>{item.actor}</strong> opened {item.itemName} and pulled{" "}
          {item.cards.map((card, index) => (
            <span key={card.printingId + index}>
              {index > 0 && ", "}
              <Link
                href={`/cards/${card.printingId}`}
                className={`underline ${RARITY_COLORS[card.rarity] ?? ""}`}
              >
                {card.name}
              </Link>
              {card.finish !== "nonfoil" && ` (${card.finish})`}
              {card.priceCents !== null && ` ${Cents.format(Cents.of(card.priceCents))}`}
            </span>
          ))}
        </>
      );
    case "purchase":
      return (
        <>
          <strong>{item.actor}</strong> bought {item.quantity > 1 ? `${item.quantity} × ` : ""}
          {item.productName}
        </>
      );
    case "trade":
      return (
        <>
          <strong>{item.actor}</strong> and <strong>{item.other}</strong> traded
          {item.cardsMoved > 0 ? ` ${item.cardsMoved} card${item.cardsMoved === 1 ? "" : "s"}` : ""}
          {item.moneyChanged ? (item.cardsMoved > 0 ? " and some money" : " money") : ""}
        </>
      );
  }
}

export function ActivityList(props: { items: readonly FeedItem[] }) {
  if (props.items.length === 0) return <p className="text-sm text-zinc-500">Nothing yet.</p>;
  return (
    <ul className="flex flex-col divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
      {props.items.map((item) => (
        <li key={item.id} className="flex flex-col gap-0.5 py-2">
          <span>
            <Line item={item} />
          </span>
          <span className="text-xs text-zinc-500">
            <LocalTime iso={item.at} withTime />
          </span>
        </li>
      ))}
    </ul>
  );
}
