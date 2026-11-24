"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { CardTile } from "@/app/_components/card-tile";
import type { PrintingCard } from "@/modules/catalog";
import { Cents } from "@/shared/kernel";
import type { Finish } from "@/shared/mtg";
import { Badge } from "@/ui/badge";
import { EmptyState } from "@/ui/empty-state";
import { Price } from "@/ui/mtg/price";
import {
  cardKey,
  combineOpenedCards,
  sortOpenedCards,
  summarizePulls,
  type CombinedOpenedCard,
  type OpenedSort,
  type SerializedOpening,
} from "./opened-summary";

const FINISH_NAMES: Record<Finish, string> = { nonfoil: "", foil: "Foil ", etched: "Etched " };

const SORT_OPTIONS: ReadonlyArray<{ value: OpenedSort; label: string }> = [
  { value: "value", label: "Value" },
  { value: "rarity", label: "Rarity" },
  { value: "duplicates", label: "Duplicates" },
  { value: "color", label: "Color" },
  { value: "order", label: "Pack order" },
];

type OpenedResultsProps = {
  openings: readonly SerializedOpening[];
  cardsById: Readonly<Record<string, PrintingCard>>;
  ownedByKey: Readonly<Record<string, number>>;
  packCount: number;
  newDecks: string | null;
};

export function OpenedResults(props: OpenedResultsProps) {
  const { openings, cardsById, ownedByKey, packCount, newDecks } = props;
  const hasMultipleOpenings = openings.length > 1;
  const [viewMode, setViewMode] = useState<"combined" | "by-pack">(
    hasMultipleOpenings ? "combined" : "by-pack",
  );
  const [sort, setSort] = useState<OpenedSort>("value");
  const [onlyDuplicates, setOnlyDuplicates] = useState(false);

  const combined = useMemo(
    () => combineOpenedCards(openings, cardsById, ownedByKey),
    [openings, cardsById, ownedByKey],
  );
  const summary = useMemo(() => summarizePulls(combined), [combined]);

  const displayedCombined = useMemo(() => {
    const filtered = onlyDuplicates ? combined.filter((item) => item.quantity > 1) : combined;
    return sortOpenedCards(filtered, sort);
  }, [combined, onlyDuplicates, sort]);

  const unpackedProducts = openings.filter((o) => o.contentKind === "product");

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Opened</h1>
        {newDecks !== null && (
          <p className="border-success-line bg-success-soft text-success-ink rounded-md border px-3 py-2 text-sm">
            Added to your decks: <strong>{newDecks}</strong>.{" "}
            <Link href="/decks" className="underline">
              Open your decks
            </Link>
          </p>
        )}
        {openings.length === 0 ? (
          <EmptyState>Nothing to show.</EmptyState>
        ) : (
          <p className="text-muted text-sm">
            {packCount > 0 && `${packCount} pack${packCount === 1 ? "" : "s"} · `}
            {summary.totalCopies > 0 && (
              <>
                {summary.totalCopies} card{summary.totalCopies === 1 ? "" : "s"} (
                {summary.uniqueStacks} unique
                {summary.duplicateCopies > 0 && `, ${summary.duplicateCopies} duplicate`}) ·{" "}
              </>
            )}
            worth{" "}
            <strong className="tabular-nums">
              <Price cents={Cents.of(summary.totalCents)} />
            </strong>{" "}
            at market price ·{" "}
            <Link href="/inventory" className="underline">
              back to inventory
            </Link>{" "}
            ·{" "}
            <Link href="/collection" className="underline">
              your collection
            </Link>
          </p>
        )}
      </header>

      {unpackedProducts.length > 0 && (
        <section aria-label="Unpacked items" className="flex flex-col gap-2">
          {unpackedProducts.map((opening) => (
            <div
              key={opening.itemId}
              className="border-border-subtle flex flex-col gap-1 rounded-lg border p-3 text-sm"
            >
              <h2 className="font-medium">{opening.name}</h2>
              {opening.children.length > 0 && (
                <p>
                  Unpacked into:{" "}
                  {opening.children.map((child, index) => (
                    <span key={child.itemId}>
                      {index > 0 && ", "}
                      {child.name}
                      {child.status === "opened" && " (opened)"}
                    </span>
                  ))}
                </p>
              )}
              {opening.extras.length > 0 && (
                <p className="text-muted">Also inside: {opening.extras.join(", ")}</p>
              )}
            </div>
          ))}
        </section>
      )}

      {hasMultipleOpenings && summary.highlights.length > 0 && (
        <section
          aria-label="Top pulls"
          className="border-border-subtle bg-surface/60 flex flex-col gap-3 rounded-xl border p-4"
        >
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold tracking-wide uppercase">Top pulls</h2>
            <span className="text-muted text-xs">Mythics &amp; $5+ hits</span>
          </div>
          <ol className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
            {summary.highlights.map((item) => (
              <OpenedCardTile key={`hl-${item.key}`} item={item} />
            ))}
          </ol>
        </section>
      )}

      {combined.length > 0 && (
        <div className="border-border-subtle flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-sm">
          {hasMultipleOpenings && (
            <div className="border-line inline-flex overflow-hidden rounded-md border">
              <button
                type="button"
                onClick={() => setViewMode("combined")}
                aria-pressed={viewMode === "combined"}
                className={`px-2.5 py-1 text-xs font-medium ${
                  viewMode === "combined"
                    ? "bg-accent text-accent-foreground"
                    : "text-muted hover:text-foreground"
                }`}
              >
                All cards ({summary.uniqueStacks})
              </button>
              <button
                type="button"
                onClick={() => setViewMode("by-pack")}
                aria-pressed={viewMode === "by-pack"}
                className={`border-line border-l px-2.5 py-1 text-xs font-medium ${
                  viewMode === "by-pack"
                    ? "bg-accent text-accent-foreground"
                    : "text-muted hover:text-foreground"
                }`}
              >
                By pack ({openings.length})
              </button>
            </div>
          )}

          {viewMode === "combined" && (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-muted text-xs">Sort:</span>
                {SORT_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setSort(option.value)}
                    aria-pressed={sort === option.value}
                    className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                      sort === option.value
                        ? "bg-accent text-accent-foreground"
                        : "border-line text-muted hover:text-foreground border"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              {summary.duplicateCopies > 0 && (
                <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={onlyDuplicates}
                    onChange={(event) => setOnlyDuplicates(event.target.checked)}
                  />
                  Only duplicates ({combined.filter((c) => c.quantity > 1).length})
                </label>
              )}
            </>
          )}
        </div>
      )}

      {combined.length > 0 && viewMode === "combined" && (
        <section aria-label="All opened cards" className="flex flex-col gap-3">
          {displayedCombined.length === 0 ? (
            <EmptyState>No duplicate pulls in this opening.</EmptyState>
          ) : (
            <ol className="grid grid-cols-3 gap-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8">
              {displayedCombined.map((item) => (
                <OpenedCardTile key={item.key} item={item} />
              ))}
            </ol>
          )}
        </section>
      )}

      {viewMode === "by-pack" &&
        openings
          .filter((o) => o.cards.length > 0)
          .map((opening) => (
            <section key={opening.itemId} aria-label={opening.name} className="flex flex-col gap-3">
              <div className="flex flex-col gap-0.5">
                <h2 className="text-lg font-medium">{opening.name}</h2>
                {opening.theme !== null && (
                  <p className="text-muted text-sm">
                    Theme: <strong>{opening.theme}</strong>
                  </p>
                )}
              </div>
              <ol className="grid grid-cols-3 gap-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8">
                {opening.cards.map((card, position) => {
                  const printing = cardsById[card.printingId];
                  if (printing === undefined) return null;
                  const unitPriceCents = Number(printing.prices[card.finish] ?? 0);
                  const key = cardKey(card.printingId, card.finish);
                  const item: CombinedOpenedCard = {
                    key: `${opening.itemId}-${position}`,
                    printing,
                    finish: card.finish,
                    quantity: card.quantity,
                    unitPriceCents,
                    totalPriceCents: unitPriceCents * card.quantity,
                    ownedTotal: key in ownedByKey ? ownedByKey[key] : null,
                    packOrder: position,
                  };
                  return <OpenedCardTile key={item.key} item={item} />;
                })}
              </ol>
            </section>
          ))}
    </div>
  );
}

function OpenedCardTile(props: { item: CombinedOpenedCard }) {
  const { item } = props;
  const quantityPrefix = item.quantity > 1 ? `${item.quantity}× · ` : "";
  const isNew = item.ownedTotal !== null && item.ownedTotal <= item.quantity;
  const alreadyOwned =
    item.ownedTotal !== null && item.ownedTotal > item.quantity
      ? `Own ${item.ownedTotal} total`
      : undefined;

  const badge =
    item.quantity > 1 || isNew ? (
      <>
        {item.quantity > 1 && (
          <Badge tone="amber" size="sm" pill className="font-bold tabular-nums shadow-sm">
            ×{item.quantity}
          </Badge>
        )}
        {isNew && (
          <Badge tone="green" size="sm" pill className="font-semibold shadow-sm">
            New
          </Badge>
        )}
      </>
    ) : undefined;

  return (
    <CardTile
      printing={item.printing}
      href={`/cards/${item.printing.id}`}
      isFoil={item.finish !== "nonfoil"}
      badge={badge}
      priceLine={`${quantityPrefix}${FINISH_NAMES[item.finish]}${Cents.format(Cents.of(item.unitPriceCents))}`}
      note={alreadyOwned}
    />
  );
}
