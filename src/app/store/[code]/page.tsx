import { notFound } from "next/navigation";
import { CardWithPreview } from "@/app/_components/card-preview";
import { printingCards, type PrintingCard } from "@/modules/catalog";
import { storePage, type ProductForSale } from "@/modules/store";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { Cents } from "@/shared/kernel";
import { shapeForCategory } from "@/ui/product-art";
import { KeyArt, ProductImage } from "@/ui/product-image";
import { KeyruneStylesheet, SetSymbol } from "@/ui/set-symbol";
import { categoryLabel, productLabel } from "../labels";
import { BuyForm } from "./buy-form";

export default async function StoreSetPage(props: PageProps<"/store/[code]">) {
  await requireActor();
  const { code } = await props.params;
  const { db, clock } = getContainer();
  const page = await storePage(db, code);
  const today = clock.now().toISOString().slice(0, 10);
  // A Commander deck shows its commander's whole card (readable on hover), so it's clear who
  // leads the deck.
  const commanderOf = (product: ProductForSale): PrintingCard | undefined =>
    product.featured ? commanders.get(product.featured.printingId) : undefined;
  const commanders = await printingCards(
    db,
    page?.products.flatMap((product) => (product.featured ? [product.featured.printingId] : [])) ??
      [],
  );
  if (page === null) notFound();
  const { set } = page;

  // Group the products by category, keeping the query's order.
  const groups = new Map<string, ProductForSale[]>();
  for (const product of page.products) {
    const label = categoryLabel(product.category);
    groups.set(label, [...(groups.get(label) ?? []), product]);
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-12">
      <KeyruneStylesheet />
      {set.keyArtId && (
        <KeyArt
          imageId={set.keyArtId}
          alt={`${set.name} key art`}
          sizes="(min-width: 1152px) 1152px, 100vw"
          className="rounded-xl"
        />
      )}
      <header className="flex items-center gap-3">
        <SetSymbol
          keyruneCode={set.keyruneCode}
          fallbackCode={set.parentKeyruneCode}
          className="text-4xl"
        />
        <div>
          <h1 className="text-2xl font-semibold">{set.name}</h1>
          <p className="text-sm text-zinc-500">
            {set.code} · released {set.releaseDate} · prices are MSRP
          </p>
        </div>
      </header>

      {[...groups].map(([label, products]) => (
        <section key={label} className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">{label}</h2>
          <ul className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">
            {products.map((product) => {
              const commander = commanderOf(product);
              return (
                <li key={product.id} className="flex flex-col gap-2">
                  {commander ? (
                    <CardWithPreview
                      printing={commander}
                      caption={`Commander: ${commander.name}`}
                    />
                  ) : (
                    <ProductImage
                      photoIds={product.photoIds}
                      setCode={set.code}
                      setName={set.name}
                      keyruneCode={set.keyruneCode}
                      label={productLabel(product.name, set.name)}
                      shape={shapeForCategory(product.category)}
                      featuredPrintingId={(product.featured ?? set.featured)?.printingId}
                      artist={(product.featured ?? set.featured)?.artist}
                    />
                  )}
                  <span className="text-sm leading-tight font-medium">{product.name}</span>
                  <span className="text-sm tabular-nums">{Cents.format(product.msrp)}</span>
                  {isUpcoming(product.releaseDate, today) && (
                    <span className="text-xs text-amber-700 dark:text-amber-400">
                      Releases {formatDay(product.releaseDate)}
                    </span>
                  )}
                  <BuyForm productId={product.id} productName={product.name} />
                  <ProductDetails product={product} />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </main>
  );
}

/** Whether a WPN release date (e.g. "2026-10-02") is after today ("2026-09-30"). */
function isUpcoming(releaseDate: string | null, today: string): releaseDate is string {
  return releaseDate !== null && releaseDate > today;
}

/** "2026-10-02" → "Oct 2". */
function formatDay(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** WPN's description and contents, as plain text, folded away until asked for. */
function ProductDetails(props: { product: ProductForSale }) {
  const { description, contents } = props.product;
  if (description === null && contents.length === 0) return null;
  return (
    <details className="text-xs text-zinc-600 dark:text-zinc-400">
      <summary className="cursor-pointer select-none">What&apos;s inside</summary>
      <div className="mt-2 flex flex-col gap-2">
        {contents.length > 0 && (
          <ul className="flex flex-col gap-0.5">
            {contents.map((line, index) => (
              <li key={index} style={{ paddingLeft: `${line.depth * 0.75}rem` }}>
                {line.depth > 0 ? "· " : ""}
                {line.text}
              </li>
            ))}
          </ul>
        )}
        {description?.split("\n").map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
        <p className="text-[10px] text-zinc-500">From Wizards of the Coast&apos;s product page.</p>
      </div>
    </details>
  );
}
