import type { PlayerProfileView } from "@/modules/social";
import { Card } from "@/ui/card";

/** The four counts, when the player shows them. */
export function ProfileStats(props: { profile: PlayerProfileView }) {
  const { profile } = props;
  return (
    <>
      {profile.stats !== null && (
        <section className="flex flex-col gap-3">
          <h2 className="font-medium">Stats</h2>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card padding="md">
              <dt className="text-muted text-xs">Total cards</dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums">
                {profile.stats.totalCards.toLocaleString()}
              </dd>
            </Card>
            <Card padding="md">
              <dt className="text-muted text-xs">Unique printings</dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums">
                {profile.stats.distinctCards.toLocaleString()}
              </dd>
            </Card>
            <Card padding="md">
              <dt className="text-muted text-xs">Packs opened</dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums">
                {profile.stats.packsOpened.toLocaleString()}
              </dd>
            </Card>
            <Card padding="md">
              <dt className="text-muted text-xs">Shared decks</dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums">
                {profile.stats.sharedDecks.toLocaleString()}
              </dd>
            </Card>
          </dl>
        </section>
      )}
    </>
  );
}
