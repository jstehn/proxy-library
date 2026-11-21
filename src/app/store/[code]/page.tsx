import { notFound } from "next/navigation";
import { CardWithPreview } from "@/app/_components/card-preview";
import { type PrintingCard } from "@/modules/catalog";
import { type ProductForSale } from "@/modules/store";
import { Cents } from "@/shared/kernel";
import { shapeForCategory } from "@/ui/product-art";
import { KeyArt, ProductImage } from "@/ui/product-image";
import { KeyruneStylesheet, SetSymbol } from "@/ui/set-symbol";
import { categoryLabel, productLabel } from "../labels";
import { BuyForm } from "./buy-form";
import { RealProductForm } from "./real-product-form";
import { readPage } from "@/server/page-instance";
import { Page } from "@/ui/page";
import { Price } from "@/ui/price";

export default async function StoreSetPage(props: PageProps<"/store/[code]">) {
  const { actor, capabilities, reads } = await readPage();
  const { code } = await props.params;

  const page = await reads.store.page(code);
  const today = capabilities.now().toISOString().slice(0, 10);
  // A Commander deck shows its commander's whole card (readable on hover), so it's clear who
  // leads the deck.
  const commanderOf = (product: ProductForSale): PrintingCard | undefined =>
    product.featured ? commanders.get(product.featured.printingId) : undefined;
  const commanders = await capabilities.printingDetails(
    page?.products.flatMap((product) => (product.featured ? [product.featured.printingId] : [])) ??
      [],
  );
  if (page === null) notFound();
  const { set } = page;
  const ownedForReal = await reads.realCollection.productCounts(
    actor,
    page.products.map((product) => product.id),
  );

  // Group the products by category, keeping the query's order.
  const groups = new Map<string, ProductForSale[]>();
  for (const product of page.products) {
    const label = categoryLabel(product.category);
    groups.set(label, [...(groups.get(label) ?? []), product]);
  }

  return (
    <Page width="6xl" spacing="roomy">
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
          <p className="text-muted text-sm">
            {set.code} · released {set.releaseDate} · prices are MSRP, or more when the cards inside
            sell back for more
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
                  {product.msrp > product.listPrice ? (
                    <span className="flex flex-col text-sm tabular-nums">
                      <span>
                        {Cents.format(product.msrp)}{" "}
                        <s className="text-muted">
                          <Price cents={product.listPrice} />
                        </s>
                      </span>
                      <span className="text-muted text-xs">
                        Priced at what its contents sell back for
                      </span>
                    </span>
                  ) : (
                    <span className="text-sm tabular-nums">
                      <Price cents={product.msrp} />
                    </span>
                  )}
                  {isUpcoming(product.releaseDate, today) && (
                    <span className="text-warning-text text-xs">
                      Releases {formatDay(product.releaseDate)}
                    </span>
                  )}
                  <BuyForm productId={product.id} productName={product.name} />
                  <RealProductForm
                    productId={product.id}
                    productName={product.name}
                    ownedForReal={ownedForReal.get(product.id) ?? 0}
                  />
                  <ProductDetails product={product} />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </Page>
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
    <details className="text-muted text-xs">
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
        <p className="text-muted text-[10px]">From Wizards of the Coast&apos;s product page.</p>
      </div>
    </details>
  );
}
