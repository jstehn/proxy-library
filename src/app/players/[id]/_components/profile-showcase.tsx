import Link from "next/link";
import { CardTile } from "@/app/_components/card-tile";
import { formatLabel } from "@/app/decks/labels";
import type { PrintingCard } from "@/modules/catalog";
import type { PlayerProfileView } from "@/modules/social";

/** The showcase deck and the showcase cards. */
export function ProfileShowcase(props: {
  profile: PlayerProfileView;
  printings: ReadonlyMap<string, PrintingCard>;
}) {
  const { profile, printings: showcasePrintings } = props;
  return (
    <>
      {profile.showcaseDeck && (
        <section className="flex flex-col gap-2">
          <h2 className="font-medium">Showcase deck</h2>
          <Link
            href={`/decks/${profile.showcaseDeck.id}`}
            className="border-border-subtle hover:border-muted flex items-center justify-between rounded-lg border p-4"
          >
            <div>
              <div className="font-medium underline">{profile.showcaseDeck.name}</div>
              <div className="text-muted text-xs">{formatLabel(profile.showcaseDeck.format)}</div>
            </div>
            <span className="text-xs underline">View deck</span>
          </Link>
        </section>
      )}

      {profile.showcaseCards.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-medium">Showcase cards</h2>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {profile.showcaseCards.map((card) => {
              const printing = showcasePrintings.get(card.printingId);
              if (!printing) return null;
              return (
                <CardTile
                  key={card.printingId}
                  printing={printing}
                  priceLine={`${card.setCode.toUpperCase()} #${card.collectorNumber}`}
                  href={`/cards/${card.printingId}`}
                />
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
