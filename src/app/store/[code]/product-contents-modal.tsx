"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { CardTile } from "@/app/_components/card-tile";
import { Cents } from "@/shared/kernel";
import { Dialog } from "@/ui/dialog";
import { Price } from "@/ui/mtg/price";
import { rarityTextClass } from "@/ui/mtg/rarity";
import { loadProductContentsAction, type HydratedProductContents } from "../actions";

const PRIMARY_TYPES = [
  "Creature",
  "Planeswalker",
  "Battle",
  "Instant",
  "Sorcery",
  "Artifact",
  "Enchantment",
  "Land",
] as const;

function typeBucket(typeLine: string, board: "main" | "side" | "commander"): string {
  if (board === "commander") return "Commander";
  if (board === "side") return "Sideboard";
  const front = typeLine.split("—")[0] ?? typeLine;
  for (const kind of PRIMARY_TYPES) {
    if (front.includes(kind)) return kind === "Land" ? "Lands" : `${kind}s`;
  }
  return "Other";
}

const BUCKET_ORDER = [
  "Commander",
  "Creatures",
  "Planeswalkers",
  "Battles",
  "Instants",
  "Sorceries",
  "Artifacts",
  "Enchantments",
  "Other",
  "Lands",
  "Sideboard",
];

type ProductContentsModalProps = {
  productId: string;
  productName: string;
};

export function ProductContentsModal(props: ProductContentsModalProps) {
  const { productId, productName } = props;
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<HydratedProductContents | null>(null);
  const [failed, setFailed] = useState(false);

  function handleOpen() {
    setOpen(true);
    if (data !== null || loading) return;
    setLoading(true);
    setFailed(false);
    void loadProductContentsAction(productId)
      .then((result) => {
        setData(result);
        if (result === null) setFailed(true);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="text-muted hover:text-foreground w-fit text-left text-xs underline underline-offset-2"
      >
        What&apos;s inside
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`What's inside: ${productName}`}
        size="xl"
        showCloseButton
      >
        {loading && <p className="text-muted py-6 text-center text-sm">Loading contents…</p>}
        {failed && !loading && (
          <p className="text-muted py-4 text-sm">Could not load contents for this product.</p>
        )}
        {data !== null && <ContentsBody data={data} />}
      </Dialog>
    </>
  );
}

function ContentsBody(props: { data: HydratedProductContents }) {
  const { data } = props;
  const hasStructured =
    data.packs.length > 0 ||
    data.decks.length > 0 ||
    data.cards.length > 0 ||
    data.extras.length > 0 ||
    data.variableNotes.length > 0;

  return (
    <div className="flex flex-col gap-6">
      {data.variableNotes.length > 0 && (
        <div className="border-warning-line bg-warning-soft text-warning-ink rounded-md border px-3 py-2 text-xs">
          {data.variableNotes.map((note, idx) => (
            <p key={idx}>{note}</p>
          ))}
        </div>
      )}

      {data.packs.map((pack) => (
        <section key={`${pack.setCode}-${pack.boosterType}`} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">
              {pack.count > 1 ? `${pack.count}× ` : ""}
              {pack.setCode} {pack.boosterType} booster{pack.count === 1 ? "" : "s"}
            </h2>
            {pack.cardsPerPack !== null && (
              <span className="text-muted text-xs">{pack.cardsPerPack} cards per pack</span>
            )}
          </div>

          {pack.rarityAverages.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {pack.rarityAverages.map((row) => (
                <span
                  key={row.label}
                  className="border-border-subtle bg-surface rounded-md border px-2 py-0.5 text-xs tabular-nums"
                >
                  <span className="font-medium">{row.average}</span>{" "}
                  <span className="text-muted">{row.label}</span>
                </span>
              ))}
            </div>
          )}

          {pack.chaseCards.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-muted text-xs font-medium tracking-wide uppercase">
                Top chase cards
              </h3>
              <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {pack.chaseCards.map((chase) => (
                  <CardTile
                    key={chase.printing.id}
                    printing={chase.printing}
                    href={`/cards/${chase.printing.id}`}
                    priceLine={Cents.format(Cents.of(chase.unitPriceCents))}
                  />
                ))}
              </ol>
            </div>
          )}
        </section>
      ))}

      {data.decks.map((deck) => (
        <DeckListSection key={`${deck.setCode}-${deck.name}`} deck={deck} />
      ))}

      {data.cards.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Included cards ({data.cards.length})</h2>
          <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {data.cards.map((card) => (
              <CardTile
                key={`${card.printing.id}/${card.finish}`}
                printing={card.printing}
                href={`/cards/${card.printing.id}`}
                isFoil={card.finish !== "nonfoil"}
                priceLine={`${card.count > 1 ? `${card.count}× · ` : ""}${card.finish === "nonfoil" ? "" : `${card.finish} · `}${Cents.format(Cents.of(card.unitPriceCents))}`}
              />
            ))}
          </ol>
        </section>
      )}

      {data.extras.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h2 className="text-sm font-semibold">Accessories &amp; extras</h2>
          <ul className="text-muted list-disc pl-5 text-xs">
            {data.extras.map((extra, idx) => (
              <li key={idx}>{extra}</li>
            ))}
          </ul>
        </section>
      )}

      {(data.wpnDescription !== null || data.wpnContents.length > 0) && (
        <section className="border-border-subtle flex flex-col gap-2 border-t pt-3 text-xs">
          <h2 className="text-muted font-medium">Product notes</h2>
          {!hasStructured && data.wpnContents.length > 0 && (
            <ul className="text-muted flex flex-col gap-0.5">
              {data.wpnContents.map((line, idx) => (
                <li key={idx} style={{ paddingLeft: `${line.depth * 0.75}rem` }}>
                  {line.depth > 0 ? "· " : ""}
                  {line.text}
                </li>
              ))}
            </ul>
          )}
          {data.wpnDescription?.split("\n").map((paragraph, idx) => (
            <p key={idx} className="text-muted">
              {paragraph}
            </p>
          ))}
          <p className="text-muted text-[10px]">From Wizards of the Coast&apos;s product page.</p>
        </section>
      )}
    </div>
  );
}

type DeckData = HydratedProductContents["decks"][number];

function DeckListSection(props: { deck: DeckData }) {
  const { deck } = props;
  const [mode, setMode] = useState<"type" | "value" | "grid">("type");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return deck.cards;
    return deck.cards.filter(
      (c) =>
        c.printing.name.toLowerCase().includes(q) ||
        (c.printing.faces[0]?.typeLine.toLowerCase().includes(q) ?? false),
    );
  }, [deck.cards, query]);

  const byType = useMemo(() => {
    const groups = new Map<string, DeckData["cards"][number][]>();
    for (const card of filtered) {
      const bucket = typeBucket(card.printing.faces[0]?.typeLine ?? "", card.board);
      const list = groups.get(bucket) ?? [];
      list.push(card);
      groups.set(bucket, list);
    }
    return BUCKET_ORDER.filter((b) => groups.has(b)).map((label) => {
      const cards = (groups.get(label) ?? []).sort((a, b) =>
        a.printing.name.localeCompare(b.printing.name),
      );
      const count = cards.reduce((sum, c) => sum + c.count, 0);
      return { label, count, cards };
    });
  }, [filtered]);

  const byValue = useMemo(
    () =>
      [...filtered].sort(
        (a, b) =>
          b.unitPriceCents - a.unitPriceCents || a.printing.name.localeCompare(b.printing.name),
      ),
    [filtered],
  );

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">{deck.name}</h2>
          <p className="text-muted text-xs">
            {deck.type} · {deck.totalCards} cards ·{" "}
            <strong className="text-foreground tabular-nums">
              <Price cents={Cents.of(deck.marketValueCents)} />
            </strong>{" "}
            market value
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter cards…"
            aria-label={`Filter cards in ${deck.name}`}
            className="border-line rounded-md border px-2 py-1 text-xs"
          />
          <div className="border-line inline-flex overflow-hidden rounded-md border">
            {(
              [
                ["type", "By type"],
                ["value", "By price"],
                ["grid", "Visual"],
              ] as const
            ).map(([value, label], idx) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                aria-pressed={mode === value}
                className={`px-2 py-1 text-xs font-medium ${idx > 0 ? "border-line border-l" : ""} ${
                  mode === value
                    ? "bg-accent text-accent-foreground"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {mode === "type" && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {byType.map((group) => (
            <div key={group.label} className="flex flex-col gap-1">
              <h3 className="text-muted border-border-subtle border-b pb-1 text-xs font-semibold uppercase">
                {group.label} ({group.count})
              </h3>
              <ul className="flex flex-col gap-0.5 text-xs">
                {group.cards.map((card, idx) => (
                  <li
                    key={`${card.printing.id}-${card.finish}-${idx}`}
                    className="flex items-baseline justify-between gap-2 py-0.5"
                  >
                    <span className="min-w-0 truncate">
                      <span className="text-muted mr-1.5 tabular-nums">{card.count}×</span>
                      <Link
                        href={`/cards/${card.printing.id}`}
                        className="font-medium hover:underline"
                      >
                        {card.printing.name}
                      </Link>
                      {card.finish !== "nonfoil" && (
                        <span className="text-muted ml-1">({card.finish})</span>
                      )}
                    </span>
                    <span className="text-muted shrink-0 tabular-nums">
                      {Cents.format(Cents.of(card.unitPriceCents))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {mode === "value" && (
        <ul className="divide-border-subtle divide-y text-xs">
          {byValue.map((card, idx) => (
            <li
              key={`${card.printing.id}-${card.finish}-${idx}`}
              className="flex items-baseline justify-between gap-2 py-1.5"
            >
              <span className="min-w-0 truncate">
                <span className="text-muted mr-1.5 tabular-nums">{card.count}×</span>
                <Link href={`/cards/${card.printing.id}`} className="font-medium hover:underline">
                  {card.printing.name}
                </Link>
                <span className={`ml-1.5 ${rarityTextClass(card.printing.rarity)}`}>
                  {card.printing.rarity}
                </span>
                {card.finish !== "nonfoil" && (
                  <span className="text-muted ml-1">· {card.finish}</span>
                )}
              </span>
              <span className="shrink-0 font-medium tabular-nums">
                {Cents.format(Cents.of(card.unitPriceCents))}
              </span>
            </li>
          ))}
        </ul>
      )}

      {mode === "grid" && (
        <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {byValue.map((card, idx) => (
            <CardTile
              key={`${card.printing.id}-${card.finish}-${idx}`}
              printing={card.printing}
              href={`/cards/${card.printing.id}`}
              isFoil={card.finish !== "nonfoil"}
              priceLine={`${card.count > 1 ? `${card.count}× · ` : ""}${Cents.format(Cents.of(card.unitPriceCents))}`}
            />
          ))}
        </ol>
      )}
    </section>
  );
}
