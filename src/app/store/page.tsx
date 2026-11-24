import Link from "next/link";
import { CardWithPreview } from "@/app/_components/card-preview";
import { Cents } from "@/shared/kernel";
import { ProductArt, shapeForCategory } from "@/ui/mtg/product-art";
import { KeyArt, ProductImage } from "@/ui/mtg/product-image";
import { KeyruneStylesheet, SetSymbol } from "@/ui/mtg/set-symbol";
import { BuyForm } from "./[code]/buy-form";
import { ProductContentsModal } from "./[code]/product-contents-modal";
import { categoryLabel, productLabel } from "./labels";
import { readPage } from "@/server/page-instance";
import { Page } from "@/ui/page";
import { EmptyState } from "@/ui/empty-state";
import { Price } from "@/ui/mtg/price";
import { buttonClass } from "@/ui/button";

export default async function StorePage(props: PageProps<"/store">) {
  const { capabilities, reads } = await readPage();
  const searchParams = await props.searchParams;
  const query = typeof searchParams.q === "string" ? searchParams.q : "";
  const category = typeof searchParams.category === "string" ? searchParams.category : "";
  const isSearching = query.trim() !== "" || category.trim() !== "";

  const result = await reads.store.search({ query, category });
  const commanders = await capabilities.printingDetails(
    result.products.flatMap((product) => (product.featured ? [product.featured.printingId] : [])),
  );

  return (
    <Page width="6xl">
      <KeyruneStylesheet />
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Store</h1>
        <p className="text-muted text-sm">
          Sealed product at its suggested retail price (MSRP), or at what its cards sell back for
          when that&apos;s more, so buying a pack to sell its cards never pays. What you buy waits
          unopened in your inventory.
        </p>
      </header>

      <search>
        <form
          action="/store"
          method="GET"
          className="border-border-subtle flex flex-wrap items-end gap-3 rounded-lg border p-3"
        >
          <div className="flex min-w-52 flex-1 flex-col gap-1">
            <label htmlFor="store-search" className="text-xs font-medium">
              Search sets, decks, or sealed products
            </label>
            <input
              id="store-search"
              name="q"
              type="search"
              defaultValue={query}
              placeholder="e.g. Bloomburrow, Play Booster, Squirreled Away…"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="search"
              className="border-line rounded-md border px-3 py-1.5 text-sm"
            />
          </div>
          {result.categories.length > 0 && (
            <div className="flex flex-col gap-1">
              <label htmlFor="store-category" className="text-xs font-medium">
                Product type
              </label>
              <select
                id="store-category"
                name="category"
                defaultValue={category}
                className="border-line rounded-md border px-3 py-1.5 text-sm"
              >
                <option value="">All types</option>
                {result.categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {categoryLabel(cat)}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="bg-accent text-accent-foreground rounded-md px-4 py-1.5 text-sm font-medium"
            >
              Search
            </button>
            {isSearching && (
              <Link href="/store" className={buttonClass({ variant: "secondary" })}>
                Clear
              </Link>
            )}
          </div>
        </form>
      </search>

      {isSearching ? (
        result.sets.length === 0 && result.products.length === 0 ? (
          <EmptyState>No sets or products matched your search.</EmptyState>
        ) : (
          <div className="flex flex-col gap-8">
            {result.sets.length > 0 && (
              <section className="flex flex-col gap-3">
                <h2 className="text-lg font-medium">Sets ({result.sets.length})</h2>
                <ul className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">
                  {result.sets.map((set) => (
                    <li key={set.code}>
                      <Link href={`/store/${set.code}`} className="flex flex-col gap-2">
                        {set.keyArtId ? (
                          <KeyArt
                            imageId={set.keyArtId}
                            alt={`${set.name} key art`}
                            sizes="(min-width: 1024px) 25vw, 50vw"
                            className="rounded-lg shadow-md"
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
                        <span className="flex items-center gap-2 text-sm font-medium">
                          <SetSymbol
                            keyruneCode={set.keyruneCode}
                            fallbackCode={set.parentKeyruneCode}
                            className="text-xl"
                          />
                          {set.name}
                        </span>
                        <span className="text-muted text-xs">
                          {set.productsForSale} products · released {set.releaseDate}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {result.products.length > 0 && (
              <section className="flex flex-col gap-3">
                <h2 className="text-lg font-medium">
                  Products ({result.products.length}
                  {result.products.length === 60 ? "+" : ""})
                </h2>
                <ul className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">
                  {result.products.map((product) => {
                    const commander = product.featured
                      ? commanders.get(product.featured.printingId)
                      : undefined;
                    return (
                      <li key={product.id} className="flex flex-col gap-2">
                        {commander ? (
                          <CardWithPreview
                            printing={commander}
                            caption={`Commander: ${commander.name}`}
                          />
                        ) : (
                          <Link href={`/store/${product.setCode}`}>
                            <ProductImage
                              photoIds={product.photoIds}
                              setCode={product.setCode}
                              setName={product.setName}
                              keyruneCode={product.keyruneCode}
                              label={productLabel(product.name, product.setName)}
                              shape={shapeForCategory(product.category)}
                              featuredPrintingId={
                                (product.featured ?? product.setFeatured)?.printingId
                              }
                              artist={(product.featured ?? product.setFeatured)?.artist}
                            />
                          </Link>
                        )}
                        <Link
                          href={`/store/${product.setCode}`}
                          className="text-sm leading-tight font-medium hover:underline"
                        >
                          {product.name}
                        </Link>
                        <Link
                          href={`/store/${product.setCode}`}
                          className="text-muted flex items-center gap-1.5 text-xs hover:underline"
                        >
                          <SetSymbol
                            keyruneCode={product.keyruneCode}
                            fallbackCode={product.parentKeyruneCode}
                            className="text-base"
                          />
                          <span>
                            {product.setName} · {categoryLabel(product.category)}
                          </span>
                        </Link>
                        {product.msrp > product.listPrice ? (
                          <span className="text-sm tabular-nums">
                            {Cents.format(product.msrp)}{" "}
                            <s className="text-muted">
                              <Price cents={product.listPrice} />
                            </s>
                          </span>
                        ) : (
                          <span className="text-sm tabular-nums">
                            <Price cents={product.msrp} />
                          </span>
                        )}
                        <BuyForm productId={product.id} productName={product.name} />
                        <ProductContentsModal productId={product.id} productName={product.name} />
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </div>
        )
      ) : result.sets.length === 0 ? (
        <EmptyState>Nothing is for sale yet.</EmptyState>
      ) : (
        <ul className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">
          {result.sets.map((set) => (
            <li key={set.code}>
              <Link href={`/store/${set.code}`} className="flex flex-col gap-2">
                {set.keyArtId ? (
                  <KeyArt
                    imageId={set.keyArtId}
                    alt={`${set.name} key art`}
                    sizes="(min-width: 1024px) 25vw, 50vw"
                    className="rounded-lg shadow-md"
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
                <span className="flex items-center gap-2 text-sm font-medium">
                  <SetSymbol
                    keyruneCode={set.keyruneCode}
                    fallbackCode={set.parentKeyruneCode}
                    className="text-xl"
                  />
                  {set.name}
                </span>
                <span className="text-muted text-xs">
                  {set.productsForSale} products · released {set.releaseDate}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
