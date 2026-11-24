import { CardFilters, Pagination } from "@/app/_components/card-filters";
import { type DeckRef } from "@/modules/decks";
import { readPage } from "@/server/page-instance";
import { Cents } from "@/shared/kernel";
import { ManaStylesheet } from "@/ui/mtg/mana";
import { SECTIONS, SORTS } from "@/app/collection/options";
import { ExportLinks } from "./card-grid";
import { readCollectionQuery } from "./collection-query";
import { CollectionSellWorkspace } from "./sell-cart";
import { CollectionTabs } from "./tabs";
import { Page } from "@/ui/page";

/** "In: Burn (4), Mono Red (2)", so you know which deck to pull a copy from. */
function deckNote(decks: readonly DeckRef[] | undefined): string | undefined {
  if (decks === undefined || decks.length === 0) return undefined;
  return `In: ${decks.map((deck) => `${deck.name} (${deck.quantity})`).join(", ")}`;
}

export default async function CollectionPage(props: PageProps<"/collection">) {
  const { actor, capabilities, reads } = await readPage();
  const searchParams = await props.searchParams;
  const { values, page, filter, isFiltered } = readCollectionQuery(searchParams);

  const [result, sets, buylistRateBps] = await Promise.all([
    reads.collection.page(actor, filter),
    reads.catalog.enabledSets(),
    reads.store.buylistRate(),
  ]);
  const printingIds = result.rows.map((row) => row.printingId);
  const [cards, inDecks] = await Promise.all([
    capabilities.printingDetails(printingIds),
    reads.decks.decksUsing(actor, printingIds),
  ]);

  const cardsById = Object.fromEntries(cards);
  const notesByPrinting: Record<string, string> = {};
  for (const id of printingIds) {
    const note = deckNote(inDecks.get(id));
    if (note) notesByPrinting[id] = note;
  }

  return (
    <Page width="6xl">
      <ManaStylesheet />
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold">Collection</h1>
          <CollectionTabs current="game" />
        </div>
        <p className="text-muted text-sm">
          {result.totals.copies} cards ({result.totals.different} different) worth{" "}
          <strong className="tabular-nums">
            {Cents.format(Cents.of(result.totals.valueCents))}
          </strong>{" "}
          at market price{isFiltered && " (matching these filters)"}.
        </p>
        <p className="text-muted text-sm">
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

      <CollectionSellWorkspace
        rows={result.rows}
        cardsById={cardsById}
        notesByPrinting={notesByPrinting}
        buylistRateBps={buylistRateBps}
      />
      <Pagination action="/collection" values={values} page={page} pageCount={result.pageCount} />
    </Page>
  );
}
