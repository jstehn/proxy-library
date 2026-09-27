import Link from "next/link";
import {
  CardFilters,
  filterValues,
  oneOf,
  pageNumber,
  Pagination,
} from "@/app/_components/card-filters";
import { CardTile } from "@/app/_components/card-tile";
import { enabledSets, printingCards } from "@/modules/catalog";
import { collectionPage, type CollectionRow } from "@/modules/collection";
import { decksUsing, type DeckRef } from "@/modules/decks";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { Cents } from "@/shared/kernel";
import { ManaStylesheet } from "@/ui/mana";

const SORTS = [
  ["mana", "Mana value"],
  ["name", "Name"],
  ["value", "Most valuable"],
  ["newest", "Newest first"],
  ["set", "Set and number"],
] as const;
const SORT_VALUES = SORTS.map(([value]) => value);

// Sections divide the page, and the sort orders cards within each (any combination).
const SECTIONS = [
  ["color", "Sections: colors"],
  ["type", "Sections: card types"],
  ["rarity", "Sections: rarity"],
  ["set", "Sections: sets"],
  ["none", "No sections"],
] as const;
const SECTION_VALUES = SECTIONS.map(([value]) => value);
const FINISH_NAMES = { nonfoil: "", foil: "Foil ", etched: "Etched " };

/** Consecutive rows with the same section label, in order (the query already sorted them). */
function sectionsOf(
  rows: readonly CollectionRow[],
): Array<{ label: string; rows: CollectionRow[] }> {
  const sections: Array<{ label: string; rows: CollectionRow[] }> = [];
  for (const row of rows) {
    const last = sections.at(-1);
    if (last !== undefined && last.label === row.section) last.rows.push(row);
    else sections.push({ label: row.section, rows: [row] });
  }
  return sections;
}

/** "In: Burn (4), Mono Red (2)", so you know which deck to pull a copy from. */
function deckNote(decks: readonly DeckRef[] | undefined): string | undefined {
  if (decks === undefined || decks.length === 0) return undefined;
  return `In: ${decks.map((deck) => `${deck.name} (${deck.quantity})`).join(", ")}`;
}

export default async function CollectionPage(props: PageProps<"/collection">) {
  const actor = await requireActor();
  const { db } = getContainer();
  const searchParams = await props.searchParams;
  const values = filterValues(searchParams);
  const page = pageNumber(searchParams);
  const finish = oneOf(values.finish, ["", "nonfoil", "foil", "etched"] as const);
  const isFiltered = ["name", "set", "rarity", "color", "finish"].some((key) => key in values);

  const [result, sets] = await Promise.all([
    collectionPage(db, actor.userId, {
      name: values.name,
      setCode: values.set,
      rarity: values.rarity,
      color: values.color,
      finish: finish === "" ? undefined : finish,
      sections: oneOf(values.sections, SECTION_VALUES),
      sort: oneOf(values.sort, SORT_VALUES),
      page,
    }),
    enabledSets(db),
  ]);
  const printingIds = result.rows.map((row) => row.printingId);
  const [cards, inDecks] = await Promise.all([
    printingCards(db, printingIds),
    decksUsing(db, actor.userId, printingIds),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-12">
      <ManaStylesheet />
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Collection</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {result.totals.copies} cards ({result.totals.different} different) worth{" "}
          <strong className="tabular-nums">
            {Cents.format(Cents.of(result.totals.valueCents))}
          </strong>{" "}
          at market price{isFiltered && " (matching these filters)"}.
        </p>
      </header>

      <CardFilters
        action="/collection"
        values={values}
        sets={sets}
        sorts={SORTS}
        sections={SECTIONS}
        showFinish
      />

      {result.rows.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No cards here.{" "}
          <Link href="/store" className="underline">
            Buy a pack
          </Link>{" "}
          or{" "}
          <Link href="/singles" className="underline">
            a single
          </Link>
          .
        </p>
      ) : (
        <div className="flex flex-col gap-8">
          {sectionsOf(result.rows).map((section) => (
            <section key={section.label || "all"} className="flex flex-col gap-3">
              {section.label && <h2 className="text-lg font-medium">{section.label}</h2>}
              <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {section.rows.map((row) => {
                  const printing = cards.get(row.printingId);
                  if (printing === undefined) return null;
                  const price = row.price === null ? "no price" : Cents.format(Cents.of(row.price));
                  return (
                    <CardTile
                      key={`${row.printingId}/${row.finish}`}
                      printing={printing}
                      isFoil={row.finish !== "nonfoil"}
                      href={`/cards/${row.printingId}`}
                      priceLine={`${row.quantity}× · ${FINISH_NAMES[row.finish]}${price}`}
                      note={deckNote(inDecks.get(row.printingId))}
                    />
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
      <Pagination action="/collection" values={values} page={page} pageCount={result.pageCount} />
    </main>
  );
}
