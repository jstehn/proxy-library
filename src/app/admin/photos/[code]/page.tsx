import Link from "next/link";
import { notFound } from "next/navigation";
import { setPhotos } from "@/modules/catalog";
import { getContainer } from "@/server/container";
import { requireAdminActor } from "@/server/session";
import { Cents } from "@/shared/kernel";
import { Alert } from "@/ui/form";
import { KeyArt } from "@/ui/product-image";
import { choosePhotoAction, setPageSlugAction } from "../actions";

// One set's WPN page and products (design doc 13): what matched, and the admin's corrections.

const MATCH_LABELS = {
  by_name: "matched by name",
  by_kind: "matched by kind",
  admin: "chosen by an admin",
} as const;

const buttonClass = "rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700";
const fieldClass =
  "rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700";

export default async function SetPhotosPage(props: PageProps<"/admin/photos/[code]">) {
  await requireAdminActor();
  const { code } = await props.params;
  const view = await setPhotos(getContainer().db, code);
  if (view === null) notFound();
  const searchParams = await props.searchParams;
  const message = typeof searchParams.message === "string" ? searchParams.message : null;
  const error = typeof searchParams.error === "string" ? searchParams.error : null;
  const pageUrl = view.slug ? `https://wpn.wizards.com/en/products/${view.slug}` : null;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-12">
      <header className="flex flex-col gap-1">
        <Link href="/admin/photos" className="text-sm underline">
          ← All sets
        </Link>
        <h1 className="text-2xl font-semibold">
          {view.setName} <span className="text-zinc-500">{view.setCode}</span>
        </h1>
      </header>
      {message && <Alert tone="success">{message}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">WPN page</h2>
        <p className="text-sm">
          {view.status === "found" && pageUrl ? (
            <>
              Read{" "}
              <a href={pageUrl} className="underline" target="_blank" rel="noreferrer">
                {pageUrl}
              </a>
              {view.checkedAt && ` on ${view.checkedAt.slice(0, 10)}`}.
            </>
          ) : view.status === "not_read" ? (
            "Not read yet: the next sync reads it."
          ) : (
            `No page read${view.error ? ` (${view.error})` : ""}. Set its address below if the set's name doesn't lead to it.`
          )}
        </p>
        <form action={setPageSlugAction} className="flex flex-wrap items-center gap-2 text-sm">
          <input type="hidden" name="code" value={view.setCode} />
          <span className="text-zinc-500">wpn.wizards.com/en/products/</span>
          <input
            name="slug"
            defaultValue={view.slugOverride ?? ""}
            placeholder={view.slug ?? "automatic"}
            aria-label="WPN page address"
            className={`${fieldClass} w-72`}
          />
          <button type="submit" className={buttonClass}>
            Save
          </button>
        </form>
        {view.keyArtId && (
          <KeyArt
            imageId={view.keyArtId}
            alt={`${view.setName} key art`}
            sizes="640px"
            className="max-w-2xl rounded-lg"
          />
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Our products</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Products listed first have no photo. Commander decks keep art featuring their commander
          unless you pick a photo; group photos (&quot;Commander Decks&quot;, prerelease packs)
          aren&apos;t labeled, so check which deck or college a photo shows.
        </p>
        <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
          {view.products.map((product) => (
            <li key={product.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
              <div className="flex h-16 w-12 items-center justify-center">
                {product.photoIds[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/artwork/${product.photoIds[0]}/small`}
                    alt=""
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  <span className="text-xs text-zinc-400">none</span>
                )}
              </div>
              <div className="flex min-w-60 flex-1 flex-col">
                <span className="font-medium">{product.name}</span>
                <span className="text-xs text-zinc-500">
                  {product.wpnName ?? "no WPN product"}
                  {product.match && ` · ${MATCH_LABELS[product.match]}`}
                  {product.photo === "none" && product.match !== null && " · generated art"}
                </span>
              </div>
              <form action={choosePhotoAction} className="flex items-center gap-2">
                <input type="hidden" name="code" value={view.setCode} />
                <input type="hidden" name="productId" value={product.id} />
                <select
                  name="choice"
                  aria-label={`Photo for ${product.name}`}
                  defaultValue={
                    product.match === "admin"
                      ? product.wpnName === null || product.photoIndex === null
                        ? "none"
                        : `${product.wpnName}|${product.photoIndex}`
                      : "auto"
                  }
                  className={`${fieldClass} max-w-64`}
                >
                  <option value="auto">Automatic</option>
                  <option value="none">Generated art</option>
                  {view.offers.flatMap((offer) =>
                    offer.photos.map((photoId, index) => (
                      <option key={`${offer.name}|${index}`} value={`${offer.name}|${index}`}>
                        {offer.name}
                        {offer.photos.length > 1 ? ` (photo ${index + 1})` : ""}
                        {photoId === null ? " (not downloaded yet)" : ""}
                      </option>
                    )),
                  )}
                </select>
                <button type="submit" className={buttonClass}>
                  Save
                </button>
              </form>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">On the WPN page</h2>
        <ul className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3 lg:grid-cols-4">
          {view.offers.map((offer) => (
            <li key={offer.name} className="flex flex-col gap-1">
              <div className="flex flex-wrap gap-1">
                {offer.photos.map((photoId, index) =>
                  photoId ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={index}
                      src={`/api/artwork/${photoId}/small`}
                      alt={`${offer.name}, photo ${index + 1}`}
                      className="h-24 w-auto object-contain"
                    />
                  ) : null,
                )}
              </div>
              <span className="font-medium">{offer.name}</span>
              <span className="text-xs text-zinc-500">
                {offer.msrpCents === null
                  ? "no MSRP listed"
                  : `MSRP ${Cents.format(Cents.of(offer.msrpCents))}`}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
