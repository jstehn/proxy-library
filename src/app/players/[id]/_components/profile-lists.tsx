import Link from "next/link";
import { formatLabel } from "@/app/decks/labels";
import type { PlayerProfileView } from "@/modules/social";
import { Badge } from "@/ui/badge";
import { Card } from "@/ui/card";
import { EmptyState } from "@/ui/empty-state";
import { LocalTime } from "@/ui/local-time";

/** The shared decks and the wishlist. */
export function ProfileLists(props: { profile: PlayerProfileView }) {
  const { profile } = props;
  return (
    <>
      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Shared decks ({profile.sharedDecks.length})</h2>
        {profile.sharedDecks.length === 0 ? (
          <EmptyState>No shared decks yet.</EmptyState>
        ) : (
          <Card as="ul" divided>
            {profile.sharedDecks.map((deck) => (
              <li key={deck.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <div>
                  <Link href={`/decks/${deck.id}`} className="font-medium underline">
                    {deck.name}
                  </Link>
                  <span className="text-muted ml-2 text-xs">{formatLabel(deck.format)}</span>
                </div>
                <span className="text-muted text-xs">
                  Updated <LocalTime iso={deck.updatedAt} />
                </span>
              </li>
            ))}
          </Card>
        )}
      </section>

      {profile.wishlist !== null && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Wishlist ({profile.wishlist.length})</h2>
            {profile.relation !== "self" && profile.wishlist.some((w) => w.youOwnCount > 0) && (
              <Link href={`/trades/new?with=${profile.userId}`} className="text-xs underline">
                Propose trade
              </Link>
            )}
          </div>
          {profile.wishlist.length === 0 ? (
            <p className="text-muted text-sm">Wishlist is empty.</p>
          ) : (
            <Card as="ul" divided>
              {profile.wishlist.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
                >
                  <div>
                    <span className="font-medium">
                      {item.quantity}× {item.cardName}
                    </span>
                    <span className="text-muted ml-2 text-xs">({item.finish})</span>
                    {item.note && <p className="text-muted text-xs">{item.note}</p>}
                  </div>
                  {profile.relation !== "self" && item.youOwnCount > 0 && (
                    <Badge tone="green" pill>
                      You own {item.youOwnCount}
                    </Badge>
                  )}
                </li>
              ))}
            </Card>
          )}
        </section>
      )}
    </>
  );
}
