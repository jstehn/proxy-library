import Link from "next/link";
import { notFound } from "next/navigation";
import { sharedWishlistFor, type SharedWishLine } from "@/modules/wishlist";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { UserId } from "@/shared/kernel";

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
  const actor = await requireActor();
  const { id } = await props.params;
  const { db } = getContainer();
  const ownerId = UserId.of(id);
  const shared = await sharedWishlistFor(db, actor.userId, ownerId);
  if (shared === null) notFound();

  const totalOwnedMatches = shared.lines.filter((line) => line.viewerOwned.length > 0).length;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-12">
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
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            Propose a trade
          </Link>
        )}
      </header>

      {shared.lines.length === 0 ? (
        <p className="text-muted text-sm">Their wishlist is empty right now.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
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
                    <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
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
    </main>
  );
}
