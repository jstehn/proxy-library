import Link from "next/link";
import { notFound } from "next/navigation";
import { CardFilters, Pagination } from "@/app/_components/card-filters";
import { CollectionCardGrid } from "@/app/collection/card-grid";
import { readCollectionQuery } from "@/app/collection/collection-query";
import { SECTIONS, SORTS } from "@/app/collection/options";
import { Cents, UserId } from "@/shared/kernel";
import { ManaStylesheet } from "@/ui/mtg/mana";
import { readPage } from "@/server/page-instance";
import { Page } from "@/ui/page";
import { EmptyState } from "@/ui/empty-state";

// Another player's real collection, read only (design doc 16, rule 5): only while they share it.
// Not shared looks the same as no such player, so the page doesn't tell who has a collection.

export default async function PlayerRealCollectionPage(props: PageProps<"/players/[id]/real">) {
  const { actor, capabilities, reads } = await readPage();
  const { id } = await props.params;

  const owner = (await reads.realCollection.shared()).find((player) => player.userId === id);
  if (owner === undefined && id !== actor.userId) notFound();
  const ownerId = UserId.of(id);
  const name = owner?.displayName ?? actor.displayName;

  const searchParams = await props.searchParams;
  const { values, page, filter } = readCollectionQuery(searchParams);
  const [result, sets, products] = await Promise.all([
    reads.realCollection.page(actor, ownerId, filter),
    reads.realCollection.sets(actor, ownerId),
    reads.realCollection.productsOf(actor, ownerId),
  ]);
  const printingIds = [
    ...new Set(
      result.rows.flatMap((row) =>
        row.variants ? row.variants.map((variant) => variant.printingId) : [row.printingId],
      ),
    ),
  ];
  const cards = await capabilities.printingDetails(printingIds);
  const path = `/players/${id}/real`;

  return (
    <Page width="6xl">
      <ManaStylesheet />
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{name}&apos;s real collection</h1>
        <p className="text-muted text-sm">
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
          <p className="text-muted text-sm">
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
        <EmptyState>No real cards here.</EmptyState>
      ) : (
        <CollectionCardGrid
          rows={result.rows}
          cards={cards}
          showSetCode={filter.sections !== "set"}
        />
      )}
      <Pagination action={path} values={values} page={page} pageCount={result.pageCount} />
    </Page>
  );
}
