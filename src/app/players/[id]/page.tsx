import { notFound } from "next/navigation";
import { readPage } from "@/server/page-instance";
import { LocalTime } from "@/ui/local-time";
import { ManaStylesheet } from "@/ui/mtg/mana";
import { Page } from "@/ui/page";
import { FriendButtons } from "./_components/friend-buttons";
import { ProfileAbout } from "./_components/profile-about";
import { ProfileLists } from "./_components/profile-lists";
import { ProfileShowcase } from "./_components/profile-showcase";
import { ProfileStats } from "./_components/profile-stats";

const ONLINE_BADGE =
  "rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";

export default async function PlayerProfilePage(props: PageProps<"/players/[id]">) {
  const { actor, capabilities, reads } = await readPage();
  const { id } = await props.params;

  const [profile, sharedReal] = await Promise.all([
    reads.social.playerProfile(actor, id),
    reads.realCollection.shared(),
  ]);

  if (profile === null) notFound();

  const isSharingReal = sharedReal.some((p) => p.userId === profile.userId);
  const showcasePrintings =
    profile.showcaseCards.length > 0
      ? await capabilities.printingDetails(profile.showcaseCards.map((c) => c.printingId))
      : new Map();

  return (
    <Page spacing="roomy">
      <ManaStylesheet />

      <header className="border-border-subtle flex flex-wrap items-start justify-between gap-4 border-b pb-6">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{profile.displayName}</h1>
            <span className="text-muted text-sm">@{profile.username}</span>
            {profile.relation === "friend" && <span className={ONLINE_BADGE}>Friends</span>}
          </div>
          <p className="text-muted text-xs">
            Joined <LocalTime iso={profile.joinedAt} />
          </p>
        </div>
        <FriendButtons profile={profile} isSharingReal={isSharingReal} />
      </header>

      <ProfileAbout profile={profile} />
      <ProfileShowcase profile={profile} printings={showcasePrintings} />
      <ProfileStats profile={profile} />
      <ProfileLists profile={profile} />
    </Page>
  );
}
