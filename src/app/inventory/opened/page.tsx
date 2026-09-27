import Link from "next/link";
import { CardTile } from "@/app/_components/card-tile";
import { printingCards, type PrintingCard } from "@/modules/catalog";
import { openingView, type OpenedCard, type OpeningView } from "@/modules/inventory";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { Cents } from "@/shared/kernel";
import { ManaStylesheet } from "@/ui/mana";
import { KeyruneStylesheet } from "@/ui/set-symbol";

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
  const raw = (await props.searchParams).items;
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

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-12">
      <KeyruneStylesheet />
      <ManaStylesheet />
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
    </main>
  );
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
