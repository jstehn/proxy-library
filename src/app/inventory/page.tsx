import Link from "next/link";
import { packKey, packPhotos, productPhotos, variantFor } from "@/modules/catalog";
import {
  recentOpenings,
  unopenedItems,
  type OpenItemError,
  type UnopenedGroup,
} from "@/modules/inventory";
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
  NothingInside:
    "The catalog lists nothing inside that product, so it wasn't opened. Tell an admin: it needs a catalog sync or a refund.",
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
  const photos = await photosFor(groups);

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
              // Precons and starter kits hold decks: "Open" goes all the way to the cards (and
              // the deck list). Boxes and bundles can still be unpacked into packs first.
              const isDeckProduct =
                group.contentKind === "product" && /deck/.test(group.category ?? "");
              // "Open all" goes inside products; for several packs it opens every one.
              const canOpenAll = group.contentKind === "product" || count > 1;
              return (
                <li key={group.itemIds[0]} className="flex flex-wrap items-center gap-3 py-3">
                  <Thumbnail
                    photoIds={photos.get(group.itemIds[0]) ?? []}
                    itemId={group.itemIds[0]}
                    setCode={group.setCode}
                  />
                  <span className="flex-1 font-medium">
                    {group.name}
                    {count > 1 && <span className="text-zinc-500"> × {count}</span>}
                  </span>
                  <form action={openAction}>
                    <input type="hidden" name="itemIds" value={group.itemIds[0]} />
                    <input type="hidden" name="mode" value={isDeckProduct ? "all" : "one"} />
                    <button
                      type="submit"
                      className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                      aria-label={`Open ${group.name}`}
                    >
                      {group.contentKind === "product" && !isDeckProduct ? "Unpack" : "Open"}
                    </button>
                  </form>
                  {canOpenAll && !isDeckProduct && (
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

/** Each group's official photos (by its first item's id): its product's, or a loose pack's. */
async function photosFor(groups: readonly UnopenedGroup[]): Promise<Map<number, string[]>> {
  const { db } = getContainer();
  const byProduct = await productPhotos(
    db,
    groups.flatMap((group) => (group.productId ? [group.productId] : [])),
  );
  const byPack = await packPhotos(
    db,
    groups.flatMap((group) =>
      group.contentKind === "pack" && group.setCode && group.boosterType
        ? [{ setCode: group.setCode, boosterType: group.boosterType }]
        : [],
    ),
  );
  const photos = new Map<number, string[]>();
  for (const group of groups) {
    const found = group.productId
      ? byProduct.get(group.productId)
      : group.setCode && group.boosterType
        ? byPack.get(packKey(group.setCode, group.boosterType))
        : undefined;
    if (found) photos.set(group.itemIds[0], found);
  }
  return photos;
}

/** A small official photo (the same pack art every time for an item), or the set's symbol. */
function Thumbnail(props: { photoIds: readonly string[]; itemId: number; setCode: string | null }) {
  if (props.photoIds.length === 0) {
    return props.setCode ? (
      <i className={`ss ss-${props.setCode.toLowerCase()} w-10 text-center text-2xl`} aria-hidden />
    ) : (
      <span className="w-10" />
    );
  }
  const imageId = props.photoIds[variantFor(props.itemId, props.photoIds.length)];
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/artwork/${imageId}/small`}
      alt=""
      loading="lazy"
      className="h-14 w-10 object-contain"
    />
  );
}
