import Link from "next/link";
import { packKey, variantFor } from "@/modules/catalog";
import type { Reads } from "@/server/composition/reads";
import { type OpenItemError, type UnopenedGroup } from "@/modules/inventory";
import { readPage } from "@/server/page-instance";
import { Alert } from "@/ui/form";
import { LocalTime } from "@/ui/local-time";
import { KeyruneStylesheet } from "@/ui/set-symbol";
import { openAction } from "./actions";
import { Button } from "@/ui/button";
import { Page } from "@/ui/page";

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
  const { actor, reads } = await readPage();
  const [groups, recent] = await Promise.all([
    reads.inventory.unopenedItems(actor),
    reads.inventory.recentOpenings(actor),
  ]);
  const error = errorMessage((await props.searchParams).error);
  const photos = await photosFor(reads, groups);

  return (
    <Page spacing="roomy">
      <KeyruneStylesheet />
      <h1 className="text-2xl font-semibold">Inventory</h1>
      {error && <Alert tone="error">{error}</Alert>}

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Unopened</h2>
        {groups.length === 0 ? (
          <p className="text-muted text-sm">
            Nothing unopened.{" "}
            <Link href="/store" className="underline">
              Visit the store
            </Link>
            .
          </p>
        ) : (
          <ul className="divide-border-subtle flex flex-col divide-y">
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
                    {count > 1 && <span className="text-muted"> × {count}</span>}
                  </span>
                  <form action={openAction}>
                    <input type="hidden" name="itemIds" value={group.itemIds[0]} />
                    <input type="hidden" name="mode" value={isDeckProduct ? "all" : "one"} />
                    <Button
                      type="submit"

                      aria-label={`Open ${group.name}`}
                    >
                      {group.contentKind === "product" && !isDeckProduct ? "Unpack" : "Open"}
                    </Button>
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
                      <Button
                        type="submit"

                        aria-label={`Open all ${group.name}`}
                        variant="secondary"
                      >
                        {group.contentKind === "product"
                          ? "Open everything inside"
                          : `Open all ${count}`}
                      </Button>
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
                <span className="text-muted">
                  <LocalTime iso={opening.openedAt} withTime />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Page>
  );
}

/** Each group's official photos (by its first item's id): its product's, or a loose pack's. */
async function photosFor(
  reads: Reads,
  groups: readonly UnopenedGroup[],
): Promise<Map<number, string[]>> {
  const byProduct = await reads.catalog.productPhotos(
    groups.flatMap((group) => (group.productId ? [group.productId] : [])),
  );
  const byPack = await reads.catalog.packPhotos(
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
