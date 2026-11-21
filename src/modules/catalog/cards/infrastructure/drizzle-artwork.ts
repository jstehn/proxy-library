// The artwork repository (design doc 13, section 8): WPN pages, their products, the links to our
// products, and which images have been downloaded.
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { DbExecutor } from "@/shared/db";
import type { ArtworkRepository, WpnPageState } from "../application/ports";
import { SetCode } from "../domain/types";
import type { ProductForMatching } from "../domain/wpn";
import {
  artworkFiles,
  cardSets,
  productWpnLinks,
  sealedProducts,
  wpnPages,
  wpnProducts,
} from "./schema";

const StatusSchema = z.enum(["found", "no_page", "unreadable"]);
const ImagesToDownloadSchema = z.array(
  z.object({ id: z.string(), url: z.string(), kind: z.enum(["product", "keyArt"]) }),
);

export function drizzleArtworkRepository(db: DbExecutor): ArtworkRepository {
  async function pageStates(): Promise<WpnPageState[]> {
    const rows = await db.select().from(wpnPages);
    return rows.map((row) => ({
      setCode: SetCode.of(row.setCode),
      slugOverride: row.slugOverride,
      status: StatusSchema.parse(row.status),
      checkedAt: row.checkedAt,
    }));
  }

  async function productsOf(setCodes: readonly SetCode[]): Promise<ProductForMatching[]> {
    if (setCodes.length === 0) return [];
    return db
      .select({
        id: sealedProducts.id,
        name: sealedProducts.name,
        setCode: sealedProducts.setCode,
        category: sealedProducts.category,
        subtype: sealedProducts.subtype,
      })
      .from(sealedProducts)
      .where(and(inArray(sealedProducts.setCode, [...setCodes]), eq(sealedProducts.isListed, true)))
      .orderBy(sealedProducts.name);
  }

  const savePage: ArtworkRepository["savePage"] = async (setCode, page, links, checkedAt) => {
    await db
      .insert(wpnPages)
      .values({ setCode, slug: page.slug, status: "found", keyArt: page.keyArt, checkedAt })
      .onConflictDoUpdate({
        target: wpnPages.setCode,
        set: { slug: page.slug, status: "found", keyArt: page.keyArt, error: null, checkedAt },
      });

    // Replace the page's products with what it offers now.
    await db.delete(wpnProducts).where(eq(wpnProducts.setCode, setCode));
    if (page.products.length > 0) {
      await db.insert(wpnProducts).values(
        page.products.map((product, position) => ({
          setCode,
          name: product.name,
          position,
          releaseDate: product.releaseDate,
          msrpCents: product.msrpCents,
          description: product.description,
          contents: product.contents,
          images: product.images,
        })),
      );
    }

    // Replace this page's automatic links; an admin's choices stay (rule 5).
    await db
      .delete(productWpnLinks)
      .where(and(eq(productWpnLinks.wpnSetCode, setCode), ne(productWpnLinks.match, "admin")));
    const chosen = await db
      .select({ productId: productWpnLinks.productId })
      .from(productWpnLinks)
      .where(eq(productWpnLinks.match, "admin"));
    const byAdmin = new Set(chosen.map((row) => row.productId));
    const automatic = links.filter((link) => !byAdmin.has(link.productId));
    if (automatic.length > 0) {
      await db
        .insert(productWpnLinks)
        .values(
          automatic.map((link) => ({
            productId: link.productId,
            wpnSetCode: setCode,
            wpnName: link.wpnName,
            match: link.match,
            photo: link.photo,
            photoIndex: null,
          })),
        )
        // A product another page already claimed keeps that link.
        .onConflictDoNothing();
    }
  };

  const savePageProblem: ArtworkRepository["savePageProblem"] = async (
    setCode,
    status,
    error,
    checkedAt,
  ) => {
    await db
      .insert(wpnPages)
      .values({ setCode, status, error, checkedAt })
      .onConflictDoUpdate({ target: wpnPages.setCode, set: { status, error, checkedAt } });
  };

  async function setSlugOverride(setCode: SetCode, slug: string | null): Promise<void> {
    await db
      .insert(wpnPages)
      .values({ setCode, slugOverride: slug, status: "no_page", checkedAt: new Date(0) })
      .onConflictDoUpdate({ target: wpnPages.setCode, set: { slugOverride: slug } });
  }

  const imagesToDownload: ArtworkRepository["imagesToDownload"] = async () => {
    const rows = await db.execute<{ id: string; url: string; kind: string }>(sql`
      select distinct image->>'id' as id, image->>'url' as url, kind
        from (
          select jsonb_array_elements(images) as image, 'product' as kind from wpn_products
          union all
          select key_art, 'keyArt' from wpn_pages where key_art is not null
        ) all_images
       where image->>'id' not in (select image_id from artwork_files)
       order by id
    `);
    return ImagesToDownloadSchema.parse(rows.rows).map(({ kind, ...image }) => ({ image, kind }));
  };

  async function markDownloaded(imageId: string, at: Date): Promise<void> {
    await db
      .insert(artworkFiles)
      .values({ imageId, downloadedAt: at })
      .onConflictDoUpdate({ target: artworkFiles.imageId, set: { downloadedAt: at } });
  }

  const photoOptions: ArtworkRepository["photoOptions"] = async (productId) => {
    const [product] = await db
      .select({ setCode: sealedProducts.setCode, parentCode: cardSets.parentCode })
      .from(sealedProducts)
      .innerJoin(cardSets, eq(cardSets.code, sealedProducts.setCode))
      .where(eq(sealedProducts.id, productId));
    if (product === undefined) return null;
    const rows = await db
      .select({ name: wpnProducts.name, images: wpnProducts.images })
      .from(wpnProducts)
      .where(inArray(wpnProducts.setCode, [product.setCode, product.parentCode ?? product.setCode]))
      .orderBy(wpnProducts.position);
    return rows.map((row) => ({
      name: row.name,
      imageCount: Array.isArray(row.images) ? row.images.length : 0,
    }));
  };

  const saveAdminChoice: ArtworkRepository["saveAdminChoice"] = async (choice) => {
    const [product] = await db
      .select({ setCode: sealedProducts.setCode, parentCode: cardSets.parentCode })
      .from(sealedProducts)
      .innerJoin(cardSets, eq(cardSets.code, sealedProducts.setCode))
      .where(eq(sealedProducts.id, choice.productId));
    // WPN lists a Commander set's decks on its main set's page.
    const wpnSetCode = choice.wpnName === null ? null : (product?.parentCode ?? product?.setCode);
    const row = {
      wpnSetCode,
      wpnName: choice.wpnName,
      match: "admin",
      photo: choice.photoIndex === null ? "none" : "one",
      photoIndex: choice.photoIndex,
    };
    await db
      .insert(productWpnLinks)
      .values({ productId: choice.productId, ...row })
      .onConflictDoUpdate({ target: productWpnLinks.productId, set: row });
  };

  async function clearAdminChoice(productId: string): Promise<SetCode | null> {
    const [product] = await db
      .select({ setCode: sealedProducts.setCode, parentCode: cardSets.parentCode })
      .from(sealedProducts)
      .innerJoin(cardSets, eq(cardSets.code, sealedProducts.setCode))
      .where(eq(sealedProducts.id, productId));
    await db
      .delete(productWpnLinks)
      .where(and(eq(productWpnLinks.productId, productId), eq(productWpnLinks.match, "admin")));
    if (product === undefined) return null;
    // WPN lists a Commander set's decks on its main set's page.
    return SetCode.of(product.parentCode ?? product.setCode);
  }

  return {
    pageStates,
    productsOf,
    savePage,
    savePageProblem,
    setSlugOverride,
    imagesToDownload,
    markDownloaded,
    photoOptions,
    saveAdminChoice,
    clearAdminChoice,
  };
}
