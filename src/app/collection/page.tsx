import Link from "next/link";
import { CardFilters, Pagination } from "@/app/_components/card-filters";
import { type DeckRef } from "@/modules/decks";
import { readPage } from "@/server/page-instance";
import { Cents } from "@/shared/kernel";
import { ManaStylesheet } from "@/ui/mana";
import { SECTIONS, SORTS } from "@/ui/collection/options";
import { CollectionCardGrid, ExportLinks } from "./card-grid";
import { readCollectionQuery } from "./collection-query";
import { CollectionTabs } from "./tabs";

/** "In: Burn (4), Mono Red (2)", so you know which deck to pull a copy from. */
function deckNote(decks: readonly DeckRef[] | undefined): string | undefined {
  if (decks === undefined || decks.length === 0) return undefined;
  return `In: ${decks.map((deck) => `${deck.name} (${deck.quantity})`).join(", ")}`;
}

export default async function CollectionPage(props: PageProps<"/collection">) {
  const { actor, capabilities, reads } = await readPage();
  const searchParams = await props.searchParams;
  const { values, page, filter, isFiltered } = readCollectionQuery(searchParams);

  const [result, sets] = await Promise.all([
    reads.collection.page(actor, filter),
    reads.catalog.enabledSets(),
  ]);
  const printingIds = result.rows.map((row) => row.printingId);
  const [cards, inDecks] = await Promise.all([
    capabilities.printingDetails(printingIds),
    capabilities.deckReads.decksUsing(actor.userId, printingIds),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-12">
      <ManaStylesheet />
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold">Collection</h1>
          <CollectionTabs current="game" />
        </div>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {result.totals.copies} cards ({result.totals.different} different) worth{" "}
          <strong className="tabular-nums">
            {Cents.format(Cents.of(result.totals.valueCents))}
          </strong>{" "}
          at market price{isFiltered && " (matching these filters)"}.
        </p>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Export everything: <ExportLinks path="/api/export/collection" />
        </p>
      </header>

      <CardFilters
        action="/collection"
        values={values}
        sets={sets}
        sorts={SORTS}
        sections={SECTIONS}
        showFinish
        notes={result.notes}
      />

      {result.rows.length === 0 ? (
        <p className="text-muted text-sm">
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
        <CollectionCardGrid
          rows={result.rows}
          cards={cards}
          noteFor={(printingId) => deckNote(inDecks.get(printingId))}
        />
      )}
      <Pagination action="/collection" values={values} page={page} pageCount={result.pageCount} />
    </main>
  );
}
