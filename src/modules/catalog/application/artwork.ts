import { isStillSettling } from "../domain/rules";
import type { SetCode } from "../domain/types";
import { ARTWORK_WIDTHS, matchWpnProducts, slugCandidates, type ArtworkSize } from "../domain/wpn";
import type { CatalogDependencies, CatalogServices, SetState, SyncKind } from "./ports";

// The WPN step of the sync (design doc 13): official product photos, key art, MSRPs and product
// details. Nothing here can fail the sync: a set whose page is missing or changed, or an image
// that won't download, is recorded and keeps the generated art (rule 4).

export type ArtworkSummary = {
  pagesRead: string[];
  noPage: string[];
  unreadable: { code: string; error: string }[];
  productsLinked: number;
  imagesDownloaded: number;
  imageFailures: number;
};

export function emptyArtworkSummary(): ArtworkSummary {
  return {
    pagesRead: [],
    noPage: [],
    unreadable: [],
    productsLinked: 0,
    imagesDownloaded: 0,
    imageFailures: 0,
  };
}

type InTransaction = <T>(work: (services: CatalogServices) => Promise<T>) => Promise<T>;

const SIZES: readonly ArtworkSize[] = ["small", "large"];

export function makeArtworkPass(dependencies: CatalogDependencies, inTransaction: InTransaction) {
  const { wpn, artworkFiles, clock } = dependencies;

  /**
   * Reads the WPN pages of main sets that are new to it, still settling (catalog rule 12), or
   * on a full run; then downloads every image not stored yet (design doc 13, rule 3).
   */
  async function artworkPass(kind: SyncKind, states: readonly SetState[]): Promise<ArtworkSummary> {
    const summary = emptyArtworkSummary();
    const now = clock.now();
    const pages = new Map(
      (await inTransaction(({ artwork }) => artwork.pageStates())).map((page) => [
        page.setCode,
        page,
      ]),
    );
    // Commander companion sets have no page of their own: their decks are on the main set's.
    const mainSets = states.filter((state) => state.isEnabled && state.type !== "commander");
    const due = mainSets.filter(
      (state) =>
        kind === "full" ||
        !pages.has(state.code) ||
        pages.get(state.code)?.status !== "found" ||
        isStillSettling(state.releaseDate, now),
    );

    for (const state of due) {
      const override = pages.get(state.code)?.slugOverride ?? null;
      const slugs = override === null ? slugCandidates(state.name) : [override];
      try {
        let read = false;
        for (const slug of slugs) {
          const page = await wpn.setPage(slug);
          if (page === null) continue;
          const companions = states
            .filter((other) => other.parentCode === state.code && other.type === "commander")
            .map((other) => other.code);
          await inTransaction(async ({ artwork }) => {
            const products = await artwork.productsOf([state.code, ...companions]);
            const links = matchWpnProducts(page, state.name, products);
            await artwork.savePage(state.code, page, links, now);
            summary.productsLinked += links.length;
          });
          summary.pagesRead.push(`${state.code} (${slug})`);
          read = true;
          break;
        }
        if (!read) {
          await inTransaction(({ artwork }) =>
            artwork.savePageProblem(state.code, "no_page", null, now),
          );
          summary.noPage.push(state.code);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await inTransaction(({ artwork }) =>
          artwork.savePageProblem(state.code, "unreadable", message, now),
        );
        summary.unreadable.push({ code: state.code, error: message });
      }
    }

    // Every image not downloaded yet, in both sizes (design doc 13, decision 4).
    const images = await inTransaction(({ artwork }) => artwork.imagesToDownload());
    for (const { image, kind: imageKind } of images) {
      try {
        for (const size of SIZES) {
          const bytes = await wpn.image(image, ARTWORK_WIDTHS[imageKind][size]);
          await artworkFiles.put(image.id, size, bytes);
        }
        await inTransaction(({ artwork }) => artwork.markDownloaded(image.id, clock.now()));
        summary.imagesDownloaded++;
      } catch {
        summary.imageFailures++; // tried again on the next sync
      }
    }
    return summary;
  }

  return artworkPass;
}

/** Sets a set's page slug by hand (or null to go back to the ones made from its name). */
export type SetSlugInput = Readonly<{ setCode: SetCode; slug: string | null }>;
