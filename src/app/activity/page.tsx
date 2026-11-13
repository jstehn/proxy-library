import Link from "next/link";
import { activityFeed } from "@/modules/activity";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { ActivityList } from "../_components/activity-list";

export default async function ActivityPage(props: PageProps<"/activity">) {
  const actor = await requireActor();
  const searchParams = await props.searchParams;
  const scope = searchParams.scope === "friends" ? "friends" : "all";
  const items = await activityFeed(getContainer().db, 50, {
    actorId: actor.userId,
    scope,
  });
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-12">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Activity</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Big pulls, sealed purchases and trades around the playgroup.
          </p>
        </div>
        <nav
          aria-label="Activity scope"
          className="flex gap-1 rounded-md border border-zinc-200 p-1 text-sm dark:border-zinc-800"
        >
          <Link
            href="/activity"
            className={`rounded px-3 py-1 ${
              scope === "all"
                ? "bg-zinc-900 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            }`}
          >
            Everyone
          </Link>
          <Link
            href="/activity?scope=friends"
            className={`rounded px-3 py-1 ${
              scope === "friends"
                ? "bg-zinc-900 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            }`}
          >
            Friends
          </Link>
        </nav>
      </header>
      <ActivityList items={items} />
    </main>
  );
}
