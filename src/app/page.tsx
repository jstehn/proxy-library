import Link from "next/link";
import { activityFeed } from "@/modules/activity";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { ActivityList } from "./_components/activity-list";

// The home page: where to go, and what the playgroup has been up to.
const sections = [
  { name: "Store", href: "/store", blurb: "Boosters, bundles, boxes and precons at MSRP." },
  { name: "Singles", href: "/singles", blurb: "Any card from an enabled set at market price." },
  { name: "Inventory", href: "/inventory", blurb: "Your unopened product. Tear something open." },
  {
    name: "Collection",
    href: "/collection",
    blurb: "Every card you've opened, bought or traded for.",
  },
  { name: "Decks", href: "/decks", blurb: "Build only from what you own, then print proxies." },
  { name: "Trades", href: "/trades", blurb: "Swap cards and money with the playgroup." },
];

export default async function Home() {
  // Runs on the server: a Server Component, the default in the App Router.
  const actor = await requireActor();
  const recent = await activityFeed(getContainer().db, 5);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-12">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Welcome, {actor.displayName}</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">Make it out of what you have.</p>
      </header>

      <ul className="grid gap-4 sm:grid-cols-2">
        {sections.map((section) => (
          <li key={section.name}>
            <Link
              href={section.href}
              className="block h-full rounded-lg border border-zinc-200 p-4 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
            >
              <h2 className="font-medium">{section.name}</h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">{section.blurb}</p>
            </Link>
          </li>
        ))}
      </ul>

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">
          Recent activity{" "}
          <Link href="/activity" className="text-sm font-normal underline">
            see all
          </Link>
        </h2>
        <ActivityList items={recent} />
      </section>
    </main>
  );
}
