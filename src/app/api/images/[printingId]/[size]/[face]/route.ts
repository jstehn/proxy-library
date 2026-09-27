import { PrintingId } from "@/modules/catalog";
import { getContainer } from "@/server/container";

const SIZES = ["small", "normal", "large"] as const;
const FACES = ["front", "back"] as const;

/**
 * A card image, from our disk cache (fetched from Scryfall the first time it's needed).
 * The URL never changes for a given image, so browsers may keep it for a year.
 */
export async function GET(
  _request: Request,
  context: RouteContext<"/api/images/[printingId]/[size]/[face]">,
) {
  const { printingId, size, face } = await context.params;
  const validSize = SIZES.find((candidate) => candidate === size);
  const validFace = FACES.find((candidate) => candidate === face);
  if (validSize === undefined || validFace === undefined || printingId === "") {
    return new Response("Not found", { status: 404 });
  }

  const image = await getContainer().catalog.imageFor({
    printingId: PrintingId.of(printingId),
    size: validSize,
    face: validFace,
  });
  if (!image.ok) return new Response("Not found", { status: 404 });

  // A fresh copy backed by a plain ArrayBuffer, which is what Response accepts as a body.
  return new Response(new Uint8Array(image.value), {
    headers: {
      "Content-Type": "image/jpeg",
      // "private": only the signed-in viewer's browser caches it, not shared proxies.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
