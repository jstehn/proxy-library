import Link from "next/link";
import { storeSets } from "@/modules/store";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { ProductArt } from "@/ui/product-art";
import { KeyArt } from "@/ui/product-image";
import { KeyruneStylesheet } from "@/ui/set-symbol";

export default async function StorePage() {
  await requireActor();
  const sets = await storeSets(getContainer().db);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-12">
      <KeyruneStylesheet />
      <header>
        <h1 className="text-2xl font-semibold">Store</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Sealed product at its suggested retail price (MSRP). What you buy waits unopened in your
          inventory.
        </p>
      </header>
      {sets.length === 0 ? (
        <p className="text-sm text-zinc-500">Nothing is for sale yet.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">
          {sets.map((set) => (
            <li key={set.code}>
              <Link href={`/store/${set.code}`} className="flex flex-col gap-2">
                {set.keyArtId ? (
                  <KeyArt
                    imageId={set.keyArtId}
                    alt={`${set.name} key art`}
                    sizes="(min-width: 1024px) 25vw, 50vw"
                    className="aspect-[4/3] w-full rounded-lg object-cover shadow-md"
                  />
                ) : (
                  <ProductArt
                    setCode={set.code}
                    setName={set.name}
                    keyruneCode={set.keyruneCode}
                    label={set.name}
                    shape="box"
                    featuredPrintingId={set.featured?.printingId}
                    artist={set.featured?.artist}
                  />
                )}
                <span className="text-sm font-medium">{set.name}</span>
                <span className="text-xs text-zinc-500">
                  {set.productsForSale} products · released {set.releaseDate}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
