import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CardFilters,
  filterValues,
  oneOf,
  pageNumber,
  Pagination,
  searchText,
} from "@/app/_components/card-filters";
import { RealCardGrid } from "@/app/collection/real/card-grid";
import { SECTION_VALUES, SECTIONS, SORT_VALUES, SORTS } from "@/app/collection/shared";
import { printingCards } from "@/modules/catalog";
import {
  realCollectionPage,
  realCollectionSets,
  realProductsOf,
  sharedRealCollections,
} from "@/modules/real-collection";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { Cents, UserId } from "@/shared/kernel";
import { ManaStylesheet } from "@/ui/mana";

// Another player's real collection, read only (design doc 16, rule 5): only while they share it.
// Not shared looks the same as no such player, so the page doesn't tell who has a collection.

export default async function PlayerRealCollectionPage(props: PageProps<"/players/[id]/real">) {
  const actor = await requireActor();
  const { id } = await props.params;
  const { db } = getContainer();
  const owner = (await sharedRealCollections(db)).find((player) => player.userId === id);
  if (owner === undefined && id !== actor.userId) notFound();
  const ownerId = UserId.of(id);
  const name = owner?.displayName ?? actor.displayName;

  const searchParams = await props.searchParams;
  const values = filterValues(searchParams);
  const page = pageNumber(searchParams);
  const finish = oneOf(values.finish, ["", "nonfoil", "foil", "etched"] as const);
  const [result, sets, products] = await Promise.all([
    realCollectionPage(db, ownerId, {
      search: searchText(values),
      setCode: values.set,
      rarity: values.rarity,
      color: values.color,
      finish: finish === "" ? undefined : finish,
      sections: oneOf(values.sections, SECTION_VALUES),
      sort: oneOf(values.sort, SORT_VALUES),
      page,
    }),
    realCollectionSets(db, ownerId),
    realProductsOf(db, ownerId),
  ]);
  const cards = await printingCards(
    db,
    result.rows.map((row) => row.printingId),
  );
  const path = `/players/${id}/real`;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-12">
      <ManaStylesheet />
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{name}&apos;s real collection</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {result.totals.copies} cards ({result.totals.different} different) worth{" "}
          <strong className="tabular-nums">
            {Cents.format(Cents.of(result.totals.valueCents))}
          </strong>{" "}
          at market price. Shared to look at only.{" "}
          {id === actor.userId && (
            <Link href="/collection/real" className="underline">
              Back to yours
            </Link>
          )}
        </p>
        {products.length > 0 && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Products: {products.map((product) => product.name).join(", ")}
          </p>
        )}
      </header>
      <CardFilters
        action={path}
        values={values}
        sets={sets}
        sorts={SORTS}
        sections={SECTIONS}
        showFinish
        notes={result.notes}
      />
      {result.rows.length === 0 ? (
        <p className="text-muted text-sm">No real cards here.</p>
      ) : (
        <RealCardGrid rows={result.rows} cards={cards} />
      )}
      <Pagination action={path} values={values} page={page} pageCount={result.pageCount} />
    </main>
  );
}
