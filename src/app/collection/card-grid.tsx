import { CardTile } from "@/app/_components/card-tile";
import type { PrintingCard } from "@/modules/catalog";
import type { CollectionRow } from "@/modules/collection";
import { Cents } from "@/shared/kernel";
import { FINISH_NAMES, sectionsOf } from "@/ui/collection/options";

/**
 * A page of owned cards in sections: the Game and Real tabs' grid, and the real collection shown
 * read only to others. `noteFor` adds a line under a card (the game tab shows its decks).
 */
export function CollectionCardGrid(props: {
  rows: readonly CollectionRow[];
  cards: ReadonlyMap<string, PrintingCard>;
  noteFor?: (printingId: string) => string | undefined;
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
                  note={props.noteFor?.(row.printingId)}
                />
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** The three export links of a collection; `path` is its export route. */
export function ExportLinks(props: { path: string }) {
  return (
    <>
      <a href={`${props.path}?format=moxfield`} className="underline">
        Moxfield CSV
      </a>{" "}
      ·{" "}
      <a href={`${props.path}?format=text`} className="underline">
        text list
      </a>{" "}
      ·{" "}
      <a href={`${props.path}?format=full`} className="underline">
        full CSV
      </a>
    </>
  );
}
