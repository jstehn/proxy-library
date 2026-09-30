import { getContainer } from "@/server/container";

const SIZES = ["small", "large"] as const;

/**
 * An official product photo or key art from WPN (design doc 13), from our disk: the sync
 * downloaded it, so this never calls Wizards. The URL never changes for an image, so browsers
 * may keep it for a year.
 */
export async function GET(
  _request: Request,
  context: RouteContext<"/api/artwork/[imageId]/[size]">,
) {
  const { imageId, size } = await context.params;
  const validSize = SIZES.find((candidate) => candidate === size);
  if (validSize === undefined) return new Response("Not found", { status: 404 });

  const image = await getContainer().catalog.artworkFor({ imageId, size: validSize });
  if (!image.ok) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(image.value), {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
