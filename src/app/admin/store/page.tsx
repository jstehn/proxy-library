import { enabledSets } from "@/modules/catalog";
import {
  currentBuylistRate,
  currentPricingMode,
  kindPrices,
  msrpsBelowResale,
  productPrices,
} from "@/modules/store";
import { getContainer } from "@/server/container";
import { requireAdminActor } from "@/server/session";
import { Cents } from "@/shared/kernel";
import { Alert } from "@/ui/form";
import {
  setBuylistRateAction,
  setKindPriceAction,
  setPricingModeAction,
  setProductPriceAction,
} from "./actions";

// MSRPs (ADR 0014): one price per product kind, and optional per-product overrides.

const inputClass =
  "w-24 rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-right text-sm tabular-nums dark:border-zinc-700";
const buttonClass = "rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700";

function PriceForm(props: {
  action: (formData: FormData) => Promise<void>;
  hidden: Record<string, string>;
  price: Cents | null;
  label: string;
}) {
  return (
    <form action={props.action} className="flex items-center gap-2">
      {Object.entries(props.hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <input
        name="price"
        aria-label={props.label}
        defaultValue={props.price === null ? "" : Cents.toPlainDollars(props.price)}
        placeholder="not sold"
        className={inputClass}
      />
      <button type="submit" className={buttonClass}>
        Save
      </button>
    </form>
  );
}

export default async function AdminStorePage(props: PageProps<"/admin/store">) {
  await requireAdminActor();
  const { db } = getContainer();
  const searchParams = await props.searchParams;
  const setCode = typeof searchParams.set === "string" ? searchParams.set.toUpperCase() : null;
  const error = typeof searchParams.error === "string" ? searchParams.error : null;
  const back = setCode === null ? "/admin/store" : `/admin/store?set=${setCode}`;
  const [rateBps, pricingMode, belowResale, kinds, sets, products] = await Promise.all([
    currentBuylistRate(db),
    currentPricingMode(db),
    msrpsBelowResale(db),
    kindPrices(db),
    enabledSets(db),
    setCode === null ? Promise.resolve([]) : productPrices(db, setCode),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-12">
      <h1 className="text-2xl font-semibold">Store prices</h1>
      {error && <Alert tone="error">{error}</Alert>}

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Buying cards from players</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          The store pays this share of a card&apos;s market price, rounded down to the cent. 0%
          means the store doesn&apos;t buy cards.
        </p>
        <form action={setBuylistRateAction} className="flex items-center gap-2 text-sm">
          <input
            name="rate"
            aria-label="Buylist rate (%)"
            defaultValue={String(rateBps / 100)}
            className={inputClass}
          />
          <span>%</span>
          <button type="submit" className={buttonClass}>
            Save
          </button>
        </form>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Pricing sealed product</h2>
        <form action={setPricingModeAction} className="flex flex-col gap-2 text-sm">
          <label className="flex items-start gap-2">
            <input
              type="radio"
              name="mode"
              value="msrp"
              defaultChecked={pricingMode === "msrp"}
              className="mt-1"
            />
            <span>
              <strong>MSRP pricing</strong> (the default): a product with Wizards&apos; official
              MSRP sells at that price. A product priced by its kind (a generic guess, like $3.99 a
              pack) is raised to what its cards sell back for, so old sets aren&apos;t sold for less
              than their cards are worth.
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="radio"
              name="mode"
              value="value"
              defaultChecked={pricingMode === "value"}
              className="mt-1"
            />
            <span>
              <strong>Value-based pricing</strong>: official MSRPs are raised too, so no product
              sells for less than its cards sell back for.
            </span>
          </label>
          <p className="text-zinc-600 dark:text-zinc-400">
            {belowResale === 0
              ? "No product with an official MSRP sells for less than its cards sell back for, so both choices give the same prices today."
              : `${belowResale} ${belowResale === 1 ? "product has" : "products have"} an official MSRP below what ${belowResale === 1 ? "its" : "their"} cards sell back for: value-based pricing raises ${belowResale === 1 ? "it" : "them"}, MSRP pricing doesn't.`}
          </p>
          <div>
            <button type="submit" className={buttonClass}>
              Save
            </button>
          </div>
        </form>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Price per kind of product</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Every product of a kind sells at this MSRP unless it has its own price below. Leave a
          price empty to stop selling that kind.
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
              <th className="py-1 font-medium">Kind</th>
              <th className="py-1 font-medium">Products</th>
              <th className="py-1 font-medium">MSRP</th>
            </tr>
          </thead>
          <tbody>
            {kinds.map((row) => (
              <tr key={row.kind} className="border-b border-zinc-100 dark:border-zinc-900">
                <td className="py-1.5">
                  <code>{row.kind}</code>
                  <div className="text-xs text-zinc-500">e.g. {row.example}</div>
                </td>
                <td className="py-1.5 tabular-nums">{row.products}</td>
                <td className="py-1.5">
                  <PriceForm
                    action={setKindPriceAction}
                    hidden={{ kind: row.kind, back }}
                    price={row.price}
                    label={`MSRP for ${row.kind}`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Price for one product</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          A product sells at its own price if it has one, else Wizards&apos; official MSRP (from its
          WPN product page), else its kind&apos;s price. The last two are raised to what its
          contents sell back for when that&apos;s more, so buying it to sell the cards never pays
          (worked out after each nightly price sync). Its own price is never raised.
        </p>
        <form method="get" className="flex items-center gap-2 text-sm">
          <select
            name="set"
            defaultValue={setCode ?? ""}
            aria-label="Set"
            className="rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 dark:border-zinc-700"
          >
            <option value="" disabled>
              Choose a set…
            </option>
            {sets.map((set) => (
              <option key={set.code} value={set.code}>
                {set.name} ({set.code})
              </option>
            ))}
          </select>
          <button type="submit" className={buttonClass}>
            Show products
          </button>
        </form>
        {products.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
                  <th className="py-1 font-medium">Product</th>
                  <th className="py-1 font-medium">Kind price</th>
                  <th className="py-1 font-medium">Official MSRP</th>
                  <th className="py-1 font-medium">Own price</th>
                  <th className="py-1 font-medium">Contents worth</th>
                  <th className="py-1 font-medium">Store price</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr key={product.id} className="border-b border-zinc-100 dark:border-zinc-900">
                    <td className="py-1.5">
                      {product.name}
                      <div className="text-xs text-zinc-500">
                        <code>{product.kind}</code>
                      </div>
                    </td>
                    <td className="py-1.5 tabular-nums">
                      {product.kindPrice === null ? "not sold" : Cents.format(product.kindPrice)}
                    </td>
                    <td className="py-1.5 tabular-nums">
                      {product.officialMsrp === null ? "—" : Cents.format(product.officialMsrp)}
                    </td>
                    <td className="py-1.5">
                      <PriceForm
                        action={setProductPriceAction}
                        hidden={{ productId: product.id, back }}
                        price={product.override}
                        label={`Own MSRP for ${product.name}`}
                      />
                    </td>
                    <td className="py-1.5 tabular-nums">
                      {product.contentsValue === null
                        ? "not valued"
                        : Cents.format(product.contentsValue)}
                      {product.isPartial && (
                        <div className="text-xs text-amber-700 dark:text-amber-400">
                          some contents couldn&apos;t be valued
                        </div>
                      )}
                    </td>
                    <td className="py-1.5 tabular-nums">
                      {product.storePrice === null
                        ? "not for sale"
                        : Cents.format(product.storePrice)}
                      {product.isRaised && (
                        <div className="text-xs text-zinc-500">raised to the resale value</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
