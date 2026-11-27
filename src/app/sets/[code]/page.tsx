import { notFound } from "next/navigation";
import { FINISHES, type PrintingCard } from "@/modules/catalog";
import { Cents } from "@/shared/kernel";
import { type Finish } from "@/shared/mtg";
import { ManaStylesheet } from "@/ui/mtg/mana";
import { KeyruneStylesheet, SetSymbol } from "@/ui/mtg/set-symbol";
import { CardPreviewGroup } from "@/app/_components/card-preview-group";
import { CardTile } from "@/app/_components/card-tile";
import { readPage } from "@/server/page-instance";
import { Page } from "@/ui/page";

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
  const { reads } = await readPage();
  const { code } = await props.params;

  const [set, printings] = await Promise.all([
    reads.catalog.findSet(code),
    reads.catalog.setPrintings(code.toUpperCase()),
  ]);
  if (set === null) notFound();

  return (
    <Page width="6xl">
      <KeyruneStylesheet />
      <ManaStylesheet />
      <header className="flex items-center gap-3">
        <SetSymbol keyruneCode={set.keyruneCode} className="text-4xl" />
        <div>
          <h1 className="text-2xl font-semibold">{set.name}</h1>
          <p className="text-muted text-sm">
            {set.code} · released {set.releaseDate} · {printings.length} printings · hover a card to
            read it
          </p>
        </div>
      </header>

      <CardPreviewGroup cards={printings.map((printing) => ({ printing }))}>
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {printings.map((printing) => (
            <CardTile key={printing.id} printing={printing} priceLine={priceLine(printing)} />
          ))}
        </ul>
      </CardPreviewGroup>
    </Page>
  );
}
