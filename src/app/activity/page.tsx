import Link from "next/link";
import { ActivityList } from "../_components/activity-list";
import { readPage } from "@/server/page-instance";

export default async function ActivityPage(props: PageProps<"/activity">) {
  const { actor, reads } = await readPage();
  const searchParams = await props.searchParams;
  const scope = searchParams.scope === "friends" ? "friends" : "all";
  const items = await reads.activity.feed(actor, { scope });
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-12">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Activity</h1>
          <p className="text-muted text-sm">
            Big pulls, sealed purchases and trades around the playgroup.
          </p>
        </div>
        <nav
          aria-label="Activity scope"
          className="border-border-subtle flex gap-1 rounded-md border p-1 text-sm"
        >
          <Link
            href="/activity"
            className={`rounded px-3 py-1 ${
              scope === "all"
                ? "bg-accent text-accent-foreground font-medium"
                : "text-muted hover:text-foreground"
            }`}
          >
            Everyone
          </Link>
          <Link
            href="/activity?scope=friends"
            className={`rounded px-3 py-1 ${
              scope === "friends"
                ? "bg-accent text-accent-foreground font-medium"
                : "text-muted hover:text-foreground"
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
