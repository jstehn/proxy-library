import { notFound } from "next/navigation";
import { FINISHES, findSet, setPrintings, type Finish, type PrintingCard } from "@/modules/catalog";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { Cents } from "@/shared/kernel";
import { ManaStylesheet } from "@/ui/mana";
import { KeyruneStylesheet, SetSymbol } from "@/ui/set-symbol";
import { CardTile } from "./card-tile";

const FINISH_LABELS: Record<Finish, string> = {
  nonfoil: "Nonfoil",
  foil: "Foil",
  etched: "Etched",
};

/** "Nonfoil $0.12 · Foil $0.24", with "—" for a finish that has no price. */
function priceLine(printing: PrintingCard): string {
  return FINISHES.filter((finish) => printing.finishes.includes(finish))
    .map((finish) => {
      const price = printing.prices[finish];
      return `${FINISH_LABELS[finish]} ${price === undefined ? "—" : Cents.format(price)}`;
    })
    .join(" · ");
}

export default async function SetPage(props: PageProps<"/sets/[code]">) {
  await requireActor();
  const { code } = await props.params;
  const { db } = getContainer();
  const set = await findSet(db, code);
  if (set === null) notFound();
  const printings = await setPrintings(db, set.code);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-12">
      <KeyruneStylesheet />
      <ManaStylesheet />
      <header className="flex items-center gap-3">
        <SetSymbol keyruneCode={set.keyruneCode} className="text-4xl" />
        <div>
          <h1 className="text-2xl font-semibold">{set.name}</h1>
          <p className="text-sm text-zinc-500">
            {set.code} · released {set.releaseDate} · {printings.length} printings · hover a card to
            read it
          </p>
        </div>
      </header>

      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {printings.map((printing) => (
          <CardTile key={printing.id} printing={printing} priceLine={priceLine(printing)} />
        ))}
      </ul>
    </main>
  );
}
