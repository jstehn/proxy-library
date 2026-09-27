import { notFound } from "next/navigation";
import { storePage, type ProductForSale } from "@/modules/store";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { Cents } from "@/shared/kernel";
import { ProductArt, shapeForCategory } from "@/ui/product-art";
import { KeyruneStylesheet, SetSymbol } from "@/ui/set-symbol";
import { categoryLabel, productLabel } from "../labels";
import { BuyForm } from "./buy-form";

export default async function StoreSetPage(props: PageProps<"/store/[code]">) {
  await requireActor();
  const { code } = await props.params;
  const page = await storePage(getContainer().db, code);
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
      <header className="flex items-center gap-3">
        <SetSymbol keyruneCode={set.keyruneCode} className="text-4xl" />
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
            {products.map((product) => (
              <li key={product.id} className="flex flex-col gap-2">
                <ProductArt
                  setCode={set.code}
                  setName={set.name}
                  keyruneCode={set.keyruneCode}
                  label={productLabel(product.name, set.name)}
                  shape={shapeForCategory(product.category)}
                  featuredPrintingId={set.featured?.printingId}
                  artist={set.featured?.artist}
                />
                <span className="text-sm leading-tight font-medium">{product.name}</span>
                <span className="text-sm tabular-nums">{Cents.format(product.msrp)}</span>
                <BuyForm productId={product.id} productName={product.name} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
