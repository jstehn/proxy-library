import type { Clock, UnitOfWork, UserId } from "@/shared/kernel";
import type {
  CardSetInfo,
  Finish,
  ImageUris,
  PriceSnapshot,
  PrintingId,
  ScryfallCard,
  SetCode,
  SetImport,
} from "../domain/types";
import type { ArtworkSize, ProductForMatching, WpnImage, WpnLink, WpnSetPage } from "../domain/wpn";

// Ports: what the catalog needs from outside (design doc 04, section 6).

/** MTGJSON, already parsed and translated by the anti-corruption layer. */
export interface MtgjsonGateway {
  /** The version of MTGJSON's current build, e.g. "5.3.0+20260926". */
  metaVersion(): Promise<string>;
  /** Every set MTGJSON knows about. */
  setList(): Promise<ReadonlyArray<{ set: CardSetInfo; isOnlineOnly: boolean }>>;
  /** One set file: printings, boosters, products and decks, digital-only things left out. */
  setFile(code: SetCode): Promise<SetImport>;
}

/** Scryfall's daily bulk file of every card, read as a stream. */
export interface ScryfallGateway {
  /** A local copy of the newest bulk file, downloaded only if Scryfall has a newer one. */
  latestBulkFile(): Promise<{ path: string; updatedAt: Date; downloaded: boolean }>;
  /** The cards in that file, one at a time (the file is never loaded whole). */
  readBulkFile(path: string): AsyncIterable<ScryfallCard>;
}

export type ImageSize = "small" | "normal" | "large";
export type ImageFace = "front" | "back";
export type ImageKey = Readonly<{ size: ImageSize; scryfallId: string; face: ImageFace }>;

export interface ImageStore {
  get(key: ImageKey): Promise<Uint8Array | null>;
  put(key: ImageKey, bytes: Uint8Array): Promise<void>;
}

export interface ImageFetcher {
  fetch(url: string): Promise<Uint8Array>;
}

export type SetState = Readonly<{
  code: SetCode;
  name: string;
  type: string; // "expansion", "commander", …
  parentCode: SetCode | null;
  releaseDate: string; // "2026-09-01"
  isEnabled: boolean;
  isSupporting: boolean;
  importedVersion: string | null; // last FULL import
  printingCount: number;
}>;

/** Everything already in the catalog, for checking a new set's references (rule 5). */
export type KnownReferences = Readonly<{
  printingIds: ReadonlySet<string>;
  productIds: ReadonlySet<string>;
  boosters: ReadonlySet<string>; // "BLB/play"
  decks: ReadonlySet<string>; // "BLB/Hare Raising"
}>;

/** Where a printing's images come from (Scryfall's addresses), or null if unknown. */
export type ImageSource = Readonly<{ scryfallId: string; images: ImageUris | null }>;

export type PricingPrinting = Readonly<{ id: PrintingId; finishes: readonly Finish[] }>;

export type CardExtras = Readonly<{
  scryfallId: string;
  images: ImageUris | null;
  legalities: Readonly<Record<string, string>>;
}>;

export interface CatalogRepository {
  /** Adds new sets and updates names and dates of known ones. Never removes a set. */
  saveSetList(sets: readonly CardSetInfo[]): Promise<void>;
  setStates(): Promise<SetState[]>;
  setEnabled(codes: readonly SetCode[], enabled: boolean): Promise<void>;
  /** Marks exactly these sets as current Standard sets (and every other set as not). */
  markStandard(codes: readonly SetCode[]): Promise<void>;
  standardSetCodes(): Promise<SetCode[]>;
  /**
   * Saves one set import in the caller's transaction. Never deletes anything (rule 2).
   * `printingsOnly` is for supporting sets: just their printings, marked as supporting.
   */
  saveImport(
    setImport: SetImport,
    options: { printingsOnly: boolean; importedAt: Date },
  ): Promise<void>;
  /** What already exists, not counting the old contents of the set being imported. */
  knownReferences(importingSet: SetCode): Promise<KnownReferences>;
  /** Every printing we hold, keyed by Scryfall id, for matching bulk-file prices. */
  printingsForPricing(): Promise<Map<string, PricingPrinting>>;
  savePriceSnapshots(snapshots: readonly PriceSnapshot[]): Promise<void>;
  saveCardExtras(extras: readonly CardExtras[]): Promise<void>;
  imageSource(printingId: PrintingId): Promise<ImageSource | null>;
}

/** Wizards Play Network, parsed and validated by the anti-corruption layer (design doc 13). */
export interface WpnGateway {
  /** A set's product page, or null when there's no page at that slug. */
  setPage(slug: string): Promise<WpnSetPage | null>;
  /** One image, resized by Wizards' image host to this width. */
  image(image: WpnImage, width: number): Promise<Uint8Array>;
}

/** Downloaded product photos and key art, on disk next to card images. */
export interface ArtworkStore {
  get(imageId: string, size: ArtworkSize): Promise<Uint8Array | null>;
  put(imageId: string, size: ArtworkSize, bytes: Uint8Array): Promise<void>;
}

/** What we know about a set's WPN page. */
export type WpnPageState = Readonly<{
  setCode: SetCode;
  slugOverride: string | null;
  status: "found" | "no_page" | "unreadable";
  checkedAt: Date;
}>;

/** An admin's own choice for one product (design doc 13, rule 5). */
export type AdminPhotoChoice = Readonly<{
  productId: string;
  /** null: no WPN product (and so no photo, MSRP or details from WPN). */
  wpnName: string | null;
  /** Which photo to show: null for none (generated art). */
  photoIndex: number | null;
}>;

export interface ArtworkRepository {
  pageStates(): Promise<WpnPageState[]>;
  /** Listed products of these sets, for matching to a WPN page. */
  productsOf(setCodes: readonly SetCode[]): Promise<ProductForMatching[]>;
  /** Saves what a set's page offered, replacing the previous read, and the product links. */
  savePage(
    setCode: SetCode,
    page: WpnSetPage,
    links: readonly WpnLink[],
    checkedAt: Date,
  ): Promise<void>;
  /** Records that a set has no page, or an unreadable one. Keeps anything read before. */
  savePageProblem(
    setCode: SetCode,
    status: "no_page" | "unreadable",
    error: string | null,
    checkedAt: Date,
  ): Promise<void>;
  setSlugOverride(setCode: SetCode, slug: string | null): Promise<void>;
  /** The images no download has stored yet, and whether each is a product photo or key art. */
  imagesToDownload(): Promise<Array<{ image: WpnImage; kind: "product" | "keyArt" }>>;
  markDownloaded(imageId: string, at: Date): Promise<void>;
  /**
   * What an admin may choose for a product: the WPN products on its set's page and how many
   * photos each has. Null when there's no such product.
   */
  photoOptions(
    productId: string,
  ): Promise<ReadonlyArray<{ name: string; imageCount: number }> | null>;
  saveAdminChoice(choice: AdminPhotoChoice): Promise<void>;
  /** Removes an admin's choice; returns the set whose page the product belongs to, if any. */
  clearAdminChoice(productId: string): Promise<SetCode | null>;
}

export type SyncKind = "full" | "prices";
export type SyncRun = Readonly<{ id: number; kind: SyncKind }>;

export interface SyncRunRepository {
  queue(run: { kind: SyncKind; requestedBy: UserId | null; requestedAt: Date }): Promise<void>;
  /** Is a run queued or running? */
  hasPending(): Promise<boolean>;
  /** Takes the oldest queued run and marks it running, unless one is already running (rule 6). */
  claimNext(now: Date): Promise<SyncRun | null>;
  finish(
    id: number,
    result: {
      status: "succeeded" | "failed";
      summary: unknown;
      error: string | null;
      finishedAt: Date;
    },
  ): Promise<void>;
  /** Runs left "running" by a crash are marked failed. Returns how many. */
  failInterrupted(now: Date): Promise<number>;
  lastStartedAt(): Promise<Date | null>;
}

export type CatalogServices = {
  catalog: CatalogRepository;
  syncRuns: SyncRunRepository;
  artwork: ArtworkRepository;
};

export type CatalogDependencies = {
  unitOfWork: UnitOfWork<CatalogServices>;
  mtgjson: MtgjsonGateway;
  scryfall: ScryfallGateway;
  images: ImageStore;
  imageFetcher: ImageFetcher;
  wpn: WpnGateway;
  artworkFiles: ArtworkStore;
  clock: Clock;
  /** When the nightly sync runs, in the server's time zone. */
  syncTime: Readonly<{ hour: number; minute: number }>;
};
