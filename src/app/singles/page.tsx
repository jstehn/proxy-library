import {
  CardFilters,
  filterValues,
  oneOf,
  pageNumber,
  Pagination,
} from "@/app/_components/card-filters";
import { CardTile } from "@/app/_components/card-tile";
import { enabledSets, FINISHES, printingCards, searchPrintings } from "@/modules/catalog";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { Cents } from "@/shared/kernel";
import { ManaStylesheet } from "@/ui/mana";

// The singles store (design doc 07): any printing in an enabled set, at market price.

const SORTS = [
  ["name", "Name"],
  ["price", "Most expensive"],
  ["number", "Set and number"],
] as const;
const FINISH_LABELS = { nonfoil: "", foil: "Foil ", etched: "Etched " };

export default async function SinglesPage(props: PageProps<"/singles">) {
  await requireActor();
  const { db } = getContainer();
  const searchParams = await props.searchParams;
  const values = filterValues(searchParams);
  const page = pageNumber(searchParams);

  const [result, sets] = await Promise.all([
    searchPrintings(db, {
      name: values.name,
      setCode: values.set,
      rarity: values.rarity,
      color: values.color,
      sort: oneOf(
        values.sort,
        SORTS.map(([value]) => value),
      ),
      page,
    }),
    enabledSets(db),
  ]);
  const cards = await printingCards(db, result.printingIds);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-12">
      <ManaStylesheet />
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Singles</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Buy any card from an enabled set at its market price. {result.total} cards match.
        </p>
      </header>
      <CardFilters action="/singles" values={values} sets={sets} sorts={SORTS} />
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {result.printingIds.map((id) => {
          const printing = cards.get(id);
          if (printing === undefined) return null;
          const prices = FINISHES.flatMap((finish) => {
            const price = printing.prices[finish];
            return price === undefined ? [] : [`${FINISH_LABELS[finish]}${Cents.format(price)}`];
          });
          return (
            <CardTile
              key={id}
              printing={printing}
              href={`/cards/${id}`}
              priceLine={prices.length === 0 ? "no price" : prices.join(" · ")}
            />
          );
        })}
      </ul>
      <Pagination action="/singles" values={values} page={page} pageCount={result.pageCount} />
    </main>
  );
}
