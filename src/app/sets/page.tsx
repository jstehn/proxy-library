import Link from "next/link";
import { KeyruneStylesheet, SetSymbol } from "@/ui/set-symbol";
import { readPage } from "@/server/page-instance";

export default async function SetsPage() {
  const { reads } = await readPage();
  const sets = await reads.catalog.enabledSets();

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-12">
      <KeyruneStylesheet />
      <h1 className="text-2xl font-semibold">Sets</h1>
      {sets.length === 0 && (
        <p className="text-muted">No sets yet. An admin can import them on the Catalog page.</p>
      )}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sets.map((set) => (
          <li key={set.code}>
            <Link
              href={`/sets/${set.code.toLowerCase()}`}
              className="border-border-subtle hover:bg-surface flex items-center gap-3 rounded-lg border p-3"
            >
              <SetSymbol keyruneCode={set.keyruneCode} className="text-3xl" />
              <span className="flex flex-col">
                <span className="font-medium">{set.name}</span>
                <span className="text-muted text-xs">
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
