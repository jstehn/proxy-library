import { CardTile } from "@/app/_components/card-tile";
import type { PrintingCard } from "@/modules/catalog";
import type { RealCollectionRow } from "@/modules/real-collection";
import { Cents } from "@/shared/kernel";
import { FINISH_NAMES, sectionsOf } from "../shared";

/** A page of real cards in sections: the Real tab's grid, also shown read only to others. */
export function RealCardGrid(props: {
  rows: readonly RealCollectionRow[];
  cards: ReadonlyMap<string, PrintingCard>;
}) {
  return (
    <div className="flex flex-col gap-8">
      {sectionsOf(props.rows).map((section) => (
        <section key={section.label || "all"} className="flex flex-col gap-3">
          {section.label && <h2 className="text-lg font-medium">{section.label}</h2>}
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {section.rows.map((row) => {
              const printing = props.cards.get(row.printingId);
              if (printing === undefined) return null;
              const price = row.price === null ? "no price" : Cents.format(Cents.of(row.price));
              return (
                <CardTile
                  key={`${row.printingId}/${row.finish}`}
                  printing={printing}
                  isFoil={row.finish !== "nonfoil"}
                  href={`/cards/${row.printingId}`}
                  priceLine={`${row.quantity}× · ${FINISH_NAMES[row.finish]}${price}`}
                />
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
