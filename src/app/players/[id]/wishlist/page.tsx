import Link from "next/link";
import { notFound } from "next/navigation";
import { type SharedWishLine } from "@/modules/wishlist";
import { UserId } from "@/shared/kernel";
import { readPage } from "@/server/page-instance";
import { Page } from "@/ui/page";

// Another player's shared wishlist, read-only (design doc 50). Never exposes targetCents,
// wallet balance, or paydays.

const PREFERENCE_TEXT = {
  nonfoil: "nonfoil",
  foil: "foil",
  etched: "etched",
  cheapest: "either finish",
};

function targetText(line: SharedWishLine): string {
  if (line.printingId !== null && line.setCode !== null && line.collectorNumber !== null) {
    return `${line.setCode} #${line.collectorNumber}, ${PREFERENCE_TEXT[line.finish]}`;
  }
  return `Any printing, ${PREFERENCE_TEXT[line.finish]}`;
}

export default async function PlayerWishlistPage(props: PageProps<"/players/[id]/wishlist">) {
  const { actor, reads } = await readPage();
  const { id } = await props.params;

  const ownerId = UserId.of(id);
  const shared = await reads.wishlist.sharedFor(actor, ownerId);
  if (shared === null) notFound();

  const totalOwnedMatches = shared.lines.filter((line) => line.viewerOwned.length > 0).length;

  return (
    <Page>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">{shared.ownerName}&apos;s wishlist</h1>
          <p className="text-muted text-sm">
            {shared.lines.length} {shared.lines.length === 1 ? "wish" : "wishes"}
            {totalOwnedMatches > 0 && ` · you own ${totalOwnedMatches} of them`}
            {id === actor.userId && (
              <>
                {" · "}
                <Link href="/wishlist" className="underline">
                  Back to yours
                </Link>
              </>
            )}
          </p>
        </div>
        {id !== actor.userId && (
          <Link
            href={`/trades/new?with=${encodeURIComponent(id)}`}
            className="bg-accent text-accent-foreground rounded-md px-3 py-1.5 text-sm font-medium"
          >
            Propose a trade
          </Link>
        )}
      </header>

      {shared.lines.length === 0 ? (
        <p className="text-muted text-sm">Their wishlist is empty right now.</p>
      ) : (
        <ul className="divide-border-subtle flex flex-col divide-y">
          {shared.lines.map((line) => {
            const ownedTotal = line.viewerOwned.reduce((sum, copy) => sum + copy.quantity, 0);
            return (
              <li key={line.id} className="flex flex-col gap-1 py-3">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">
                    {line.quantity}× {line.cardName}
                  </span>
                  <span className="text-muted text-xs">{targetText(line)}</span>
                  {id !== actor.userId && ownedTotal > 0 && (
                    <span className="text-success-text text-xs font-medium">
                      You own {ownedTotal}
                    </span>
                  )}
                </div>
                {line.note !== "" && <p className="text-muted text-sm">{line.note}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </Page>
  );
}
