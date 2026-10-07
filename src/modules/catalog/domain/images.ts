import type { FaceImageUris } from "./types";

/** The sizes of card image the catalog caches (the art crop for playtest proxies, design doc 22). */
export type ImageSize = "small" | "normal" | "large" | "artCrop";

/**
 * Where to download one size of a face's image. Printings synced before phase 22 have no stored
 * art crop; Scryfall keeps it at the same path as the large image, under `art_crop` instead.
 */
export function imageUrl(uris: FaceImageUris, size: ImageSize): string {
  if (size !== "artCrop") return uris[size];
  return uris.artCrop ?? uris.large.replace("/large/", "/art_crop/");
}
