import { PrintingId } from "@/modules/catalog";
import { readCapabilities } from "@/server/page-instance";

const SIZES = ["small", "normal", "large", "artCrop"] as const;
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

  const capabilities = readCapabilities();
  const image = await capabilities.catalog.imageFor({
    printingId: PrintingId.of(printingId),
    size: validSize,
    face: validFace,
  });
  if (!image.ok) return new Response("Not found", { status: 404 });

  // Zero-copy view over the underlying buffer (Buffer satisfies BodyInit without copying bytes).
  const body = Buffer.from(
    image.value.buffer,
    image.value.byteOffset,
    image.value.byteLength,
  ) as Buffer<ArrayBuffer>;
  return new Response(body, {
    headers: {
      "Content-Type": "image/jpeg",
      // Card images are public (`src/proxy.ts`), so shared caches may store them too.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
