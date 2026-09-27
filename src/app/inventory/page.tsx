import Link from "next/link";
import { recentOpenings, unopenedItems, type OpenItemError } from "@/modules/inventory";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { Alert } from "@/ui/form";
import { LocalTime } from "@/ui/local-time";
import { KeyruneStylesheet } from "@/ui/set-symbol";
import { openAction } from "./actions";

const ERROR_MESSAGES: Record<OpenItemError["kind"], string> = {
  ItemNotFound: "That item isn't in your inventory.",
  AlreadyOpened: "That's already been opened.",
  BoosterUnavailable: "That pack's recipe is missing from the catalog. Ask an admin to sync.",
  DeckUnavailable: "That deck's list is missing from the catalog. Ask an admin to sync.",
  ProductUnavailable: "That product is missing from the catalog. Ask an admin to sync.",
};

function errorMessage(kind: string | string[] | undefined): string | null {
  if (typeof kind !== "string") return null;
  return kind in ERROR_MESSAGES ? ERROR_MESSAGES[kind as OpenItemError["kind"]] : null;
}

export default async function InventoryPage(props: PageProps<"/inventory">) {
  const actor = await requireActor();
  const { db } = getContainer();
  const [groups, recent] = await Promise.all([
    unopenedItems(db, actor.userId),
    recentOpenings(db, actor.userId),
  ]);
  const error = errorMessage((await props.searchParams).error);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-12">
      <KeyruneStylesheet />
      <h1 className="text-2xl font-semibold">Inventory</h1>
      {error && <Alert tone="error">{error}</Alert>}

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Unopened</h2>
        {groups.length === 0 ? (
          <p className="text-sm text-zinc-500">
            Nothing unopened.{" "}
            <Link href="/store" className="underline">
              Visit the store
            </Link>
            .
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
            {groups.map((group) => {
              const count = group.itemIds.length;
              // "Open all" goes inside products; for several packs it opens every one.
              const canOpenAll = group.contentKind === "product" || count > 1;
              return (
                <li key={group.itemIds[0]} className="flex flex-wrap items-center gap-3 py-3">
                  {group.setCode && (
                    <i className={`ss ss-${group.setCode.toLowerCase()} text-2xl`} aria-hidden />
                  )}
                  <span className="flex-1 font-medium">
                    {group.name}
                    {count > 1 && <span className="text-zinc-500"> × {count}</span>}
                  </span>
                  <form action={openAction}>
                    <input type="hidden" name="itemIds" value={group.itemIds[0]} />
                    <input type="hidden" name="mode" value="one" />
                    <button
                      type="submit"
                      className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                      aria-label={`Open ${group.name}`}
                    >
                      {group.contentKind === "product" ? "Unpack" : "Open"}
                    </button>
                  </form>
                  {canOpenAll && (
                    <form action={openAction}>
                      <input
                        type="hidden"
                        name="itemIds"
                        value={(group.contentKind === "product"
                          ? group.itemIds.slice(0, 1)
                          : group.itemIds
                        ).join(",")}
                      />
                      <input type="hidden" name="mode" value="all" />
                      <button
                        type="submit"
                        className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
                        aria-label={`Open all ${group.name}`}
                      >
                        {group.contentKind === "product"
                          ? "Open everything inside"
                          : `Open all ${count}`}
                      </button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {recent.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-medium">Recently opened</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {recent.map((opening) => (
              <li key={opening.itemId}>
                <Link href={`/inventory/opened?items=${opening.itemId}`} className="underline">
                  {opening.name}
                </Link>{" "}
                <span className="text-zinc-500">
                  <LocalTime iso={opening.openedAt} withTime />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
