import Link from "next/link";
import { CardTile } from "@/app/_components/card-tile";
import { printingCards, type PrintingCard } from "@/modules/catalog";
import { openingView, type OpenedCard, type OpeningView } from "@/modules/inventory";
import { findSet } from "@/modules/catalog";
import { storePage } from "@/modules/store";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { Cents } from "@/shared/kernel";
import { ManaStylesheet } from "@/ui/mana";
import type { OpenerPack } from "@/ui/opening/machine";
import { PackOpener } from "@/ui/opening/pack-opener";
import { KeyruneStylesheet } from "@/ui/set-symbol";
import { productLabel } from "../../store/labels";

// What one or more openings produced: packs in reveal order, decks, and what boxes unpacked into.
// (Phase 8 turns a pack into an animated reveal.)

const MAX_SHOWN = 100;
const FINISH_NAMES = { nonfoil: "", foil: "Foil ", etched: "Etched " };

function valueOf(card: OpenedCard, printing: PrintingCard | undefined): Cents {
  const each = printing?.prices[card.finish] ?? Cents.zero;
  return Cents.of(each * card.quantity);
}

export default async function OpenedPage(props: PageProps<"/inventory/opened">) {
  const actor = await requireActor();
  const { db } = getContainer();
  const searchParams = await props.searchParams;
  const raw = searchParams.items;
  const animate = searchParams.animate === "1";
  const ids = (typeof raw === "string" ? raw.split(",") : [])
    .map(Number)
    .filter((id) => Number.isSafeInteger(id) && id > 0)
    .slice(0, MAX_SHOWN);

  const openings = (await Promise.all(ids.map((id) => openingView(db, actor.userId, id)))).filter(
    (opening): opening is OpeningView => opening !== null,
  );
  const cards = await printingCards(
    db,
    openings.flatMap((opening) => opening.cards.map((card) => card.printingId)),
  );
  const packs = openings.filter((opening) => opening.contentKind === "pack");
  const total = Cents.sum(
    openings.flatMap((opening) =>
      opening.cards.map((card) => valueOf(card, cards.get(card.printingId))),
    ),
  );

  const results = (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Opened</h1>
        {openings.length === 0 ? (
          <p className="text-sm text-zinc-500">Nothing to show.</p>
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {packs.length > 0 && `${packs.length} pack${packs.length === 1 ? "" : "s"} · `}
            cards worth <strong className="tabular-nums">{Cents.format(total)}</strong> at market
            price ·{" "}
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

      {openings.map((opening) => (
        <section key={opening.itemId} aria-label={opening.name} className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">{opening.name}</h2>
          {opening.contentKind === "product" && <Unpacked opening={opening} />}
          {opening.cards.length > 0 && (
            <ol className="grid grid-cols-3 gap-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8">
              {opening.cards.map((card, position) => {
                const printing = cards.get(card.printingId);
                if (printing === undefined) return null;
                const quantity = card.quantity > 1 ? `${card.quantity}× · ` : "";
                return (
                  <CardTile
                    key={position}
                    printing={printing}
                    isFoil={card.finish !== "nonfoil"}
                    priceLine={`${quantity}${FINISH_NAMES[card.finish]}${Cents.format(printing.prices[card.finish] ?? Cents.zero)}`}
                  />
                );
              })}
            </ol>
          )}
        </section>
      ))}
    </>
  );

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-12">
      <KeyruneStylesheet />
      <ManaStylesheet />
      {animate && packs.length > 0 ? (
        <PackOpener packs={await openerPacks(packs, cards)}>{results}</PackOpener>
      ) : (
        results
      )}
    </main>
  );
}

/**
 * The packs as the opener needs them. The art on the pack is the set's featured card, never a
 * card from inside it, so the front of the pack gives nothing away.
 */
async function openerPacks(
  packs: readonly OpeningView[],
  cards: Map<string, PrintingCard>,
): Promise<OpenerPack[]> {
  const { db } = getContainer();
  const setCodes = [...new Set(packs.flatMap((pack) => (pack.setCode ? [pack.setCode] : [])))];
  const sets = new Map(
    await Promise.all(
      setCodes.map(async (code) => {
        const [set, page] = await Promise.all([findSet(db, code), storePage(db, code)]);
        return [code, { set, featured: page?.set.featured ?? null }] as const;
      }),
    ),
  );

  return packs.map((pack) => {
    const info = pack.setCode === null ? undefined : sets.get(pack.setCode);
    const setName = info?.set?.name ?? pack.setCode ?? "";
    return {
      itemId: pack.itemId,
      name: pack.name,
      setCode: pack.setCode ?? "",
      setName,
      keyruneCode: info?.set?.keyruneCode ?? "",
      label: productLabel(pack.name, setName),
      featuredPrintingId: info?.featured?.printingId ?? null,
      cards: pack.cards.map((card) => {
        const printing = cards.get(card.printingId);
        return {
          printingId: card.printingId,
          name: printing?.name ?? "Unknown card",
          rarity: printing?.rarity ?? "common",
          finish: card.finish,
          priceCents: printing?.prices[card.finish] ?? null,
          hasImage: printing?.hasImage ?? false,
          variantLabel: printing?.variantLabel ?? "",
        };
      }),
    };
  });
}

function Unpacked(props: { opening: OpeningView }) {
  const { opening } = props;
  return (
    <div className="flex flex-col gap-1 text-sm">
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
        <p className="text-zinc-500">Also inside: {opening.extras.join(", ")}</p>
      )}
    </div>
  );
}
