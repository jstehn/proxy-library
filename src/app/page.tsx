import Link from "next/link";
import { ActivityList } from "./_components/activity-list";
import { readPage } from "@/server/page-instance";
import { Page } from "@/ui/page";

// The home page: where to go, and what the playgroup has been up to.
const sections = [
  {
    name: "Store",
    href: "/store",
    blurb: "Boosters, bundles, boxes and precons, at MSRP or more.",
  },
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
  const { actor, reads } = await readPage();
  const recent = await reads.activity.feed(actor, { limit: 5 });

  return (
    <Page width="3xl" spacing="roomy">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Welcome, {actor.displayName}</h1>
        <p className="text-muted mt-2">Make it out of what you have.</p>
      </header>

      <ul className="grid gap-4 sm:grid-cols-2">
        {sections.map((section) => (
          <li key={section.name}>
            <Link
              href={section.href}
              className="border-border-subtle hover:border-muted block h-full rounded-lg border p-4"
            >
              <h2 className="font-medium">{section.name}</h2>
              <p className="text-muted text-sm">{section.blurb}</p>
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
    </Page>
  );
}
