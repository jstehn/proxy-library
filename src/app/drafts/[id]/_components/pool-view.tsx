import type { PrintingCard } from "@/modules/catalog";
import type { DraftView, SeenCard } from "@/modules/drafts";
import { curveSlotLabel } from "@/shared/kernel";
import { COLUMN_LABELS, curveOf, poolColumns, stacksOf } from "./pool";

export const refKey = (card: { ref: { packNumber: number; slot: number } }) =>
  `${card.ref.packNumber}:${card.ref.slot}`;

export function Picks(props: {
  cards: readonly SeenCard[];
  printings: ReadonlyMap<string, PrintingCard>;
}) {
  const faceOf = (card: SeenCard) => props.printings.get(card.printingId)?.faces[0];
  const columns = poolColumns(props.cards, faceOf);
  const curve = curveOf(props.cards, faceOf);
  if (props.cards.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <h2 className="font-medium">Your pool ({props.cards.length})</h2>
        <Curve counts={curve} />
      </div>
      <div className="flex flex-wrap gap-4">
        {columns.map(({ column, cards }) => (
          <div key={column} className="flex w-36 flex-col gap-1">
            <h3 className="text-muted text-xs font-semibold">
              {COLUMN_LABELS[column]} ({cards.length})
            </h3>
            <ul className="flex flex-col gap-0.5 text-sm">
              {stacksOf(cards, (card) => `${card.printingId}/${card.finish}`).map(
                ({ card, count, all }) => (
                  <li
                    key={refKey(card)}
                    className="truncate"
                    title={`Pick ${card.pick?.pickNumber ?? ""}`}
                  >
                    {count > 1 && <span className="tabular-nums">{count} × </span>}
                    {props.printings.get(card.printingId)?.name ?? "Unknown card"}
                    {card.finish !== "nonfoil" && (
                      <span className="text-xs text-sky-600 dark:text-sky-400"> {card.finish}</span>
                    )}
                    {all.some((each) => each.pick?.state === "faceUp") && (
                      <span className="text-xs text-violet-600 dark:text-violet-300"> face up</span>
                    )}
                    {all.some((each) => each.pick?.auto) && (
                      <span className="text-muted text-xs"> (auto)</span>
                    )}
                  </li>
                ),
              )}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

export const basicCount = (you: NonNullable<DraftView["you"]>) =>
  you.basicsReceived.reduce((sum, basic) => sum + basic.quantity, 0);

/** A small bar chart of how many spells cost 0, 1, … 7 or more. */
function Curve(props: { counts: readonly number[] }) {
  const most = Math.max(1, ...props.counts);
  return (
    <figure className="flex items-end gap-1" aria-label="Mana curve of your spells">
      {props.counts.map((count, index) => (
        <span key={index} className="text-muted flex w-6 flex-col items-center gap-0.5 text-[10px]">
          <span className="tabular-nums">{count}</span>
          <span
            aria-hidden
            className="bg-muted w-4 rounded-sm"
            style={{ height: `${Math.max(2, (count / most) * 28)}px` }}
          />
          <span>{curveSlotLabel(index)}</span>
        </span>
      ))}
    </figure>
  );
}
