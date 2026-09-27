import { requireActor } from "@/server/session";
import { Cents } from "@/shared/kernel";

// Placeholder home page. Each section becomes a real route in later phases.
const sections = [
  { name: "Wallet", phase: 3, blurb: "Allowance, grants and what you've spent." },
  { name: "Store", phase: 6, blurb: "Buy boosters, bundles and boxes." },
  { name: "Inventory", phase: 6, blurb: "Your unopened product." },
  { name: "Collection", phase: 7, blurb: "Every card you have opened or bought." },
  { name: "Decks", phase: 9, blurb: "Build only from cards you own." },
  { name: "Trades", phase: 10, blurb: "Swap cards and cash with friends." },
];

export default async function Home() {
  // Runs on the server: a Server Component, the default in the App Router.
  const actor = await requireActor();
  const examplePrice = Cents.fromUsd("0.30");

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-12">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Welcome, {actor.displayName}</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">Make it out of what you have.</p>
      </header>

      <ul className="grid gap-4 sm:grid-cols-2">
        {sections.map((section) => (
          <li
            key={section.name}
            className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <h2 className="font-medium">{section.name}</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{section.blurb}</p>
            <p className="mt-2 text-xs text-zinc-500">Coming in phase {section.phase}</p>
          </li>
        ))}
      </ul>

      <p className="text-sm text-zinc-500">
        Sanity check: a common worth {examplePrice === null ? "n/a" : Cents.format(examplePrice)}.
      </p>
    </main>
  );
}
