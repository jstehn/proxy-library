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
import { collectionPage } from "@/modules/collection";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { Cents } from "@/shared/kernel";
import { ManaStylesheet } from "@/ui/mana";

const SORTS = [
  ["newest", "Newest first"],
  ["value", "Most valuable"],
  ["name", "Name"],
  ["set", "Set and number"],
] as const;
const SORT_VALUES = SORTS.map(([value]) => value);
const FINISH_NAMES = { nonfoil: "", foil: "Foil ", etched: "Etched " };

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
      sort: oneOf(values.sort, SORT_VALUES),
      page,
    }),
    enabledSets(db),
  ]);
  const cards = await printingCards(
    db,
    result.rows.map((row) => row.printingId),
  );

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

      <CardFilters action="/collection" values={values} sets={sets} sorts={SORTS} showFinish />

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
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {result.rows.map((row) => {
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
              />
            );
          })}
        </ul>
      )}
      <Pagination action="/collection" values={values} page={page} pageCount={result.pageCount} />
    </main>
  );
}
