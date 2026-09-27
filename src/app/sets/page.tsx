import Link from "next/link";
import { enabledSets } from "@/modules/catalog";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { KeyruneStylesheet, SetSymbol } from "@/ui/set-symbol";

export default async function SetsPage() {
  await requireActor();
  const sets = await enabledSets(getContainer().db);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-12">
      <KeyruneStylesheet />
      <h1 className="text-2xl font-semibold">Sets</h1>
      {sets.length === 0 && (
        <p className="text-zinc-600 dark:text-zinc-400">
          No sets yet. An admin can import them on the Catalog page.
        </p>
      )}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sets.map((set) => (
          <li key={set.code}>
            <Link
              href={`/sets/${set.code.toLowerCase()}`}
              className="flex items-center gap-3 rounded-lg border border-zinc-200 p-3 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
            >
              <SetSymbol keyruneCode={set.keyruneCode} className="text-3xl" />
              <span className="flex flex-col">
                <span className="font-medium">{set.name}</span>
                <span className="text-xs text-zinc-500">
                  {set.code} · {set.releaseDate.slice(0, 4)} · {set.printingCount} cards
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
