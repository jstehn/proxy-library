import { activityFeed } from "@/modules/activity";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { ActivityList } from "../_components/activity-list";

export default async function ActivityPage() {
  await requireActor();
  const items = await activityFeed(getContainer().db, 50);
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-12">
      <header>
        <h1 className="text-2xl font-semibold">Activity</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Big pulls, sealed purchases and trades around the playgroup.
        </p>
      </header>
      <ActivityList items={items} />
    </main>
  );
}
