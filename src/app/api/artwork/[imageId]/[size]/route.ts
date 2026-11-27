import { readPage } from "@/server/page-instance";

const SIZES = ["small", "large"] as const;

/**
 * An official product photo or key art from WPN (design doc 13), from our disk: the sync
 * downloaded it, so this never calls Wizards. The URL never changes for an image, so browsers
 * may keep it for a year. Only a signed-in player gets it: the proxy only checks that a cookie
 * exists, so the route checks the session itself (design doc 67, finding F10). Card images under
 * /api/images stay public.
 */
export async function GET(
  _request: Request,
  context: RouteContext<"/api/artwork/[imageId]/[size]">,
) {
  const { imageId, size } = await context.params;
  const validSize = SIZES.find((candidate) => candidate === size);
  if (validSize === undefined) return new Response("Not found", { status: 404 });

  const { actor, capabilities } = await readPage({ allowVisitors: true });
  if (actor === null) return new Response("Sign in to see this image", { status: 401 });
  const image = await capabilities.catalog.artworkFor({ imageId, size: validSize });
  if (!image.ok) return new Response("Not found", { status: 404 });

  const body = Buffer.from(
    image.value.buffer,
    image.value.byteOffset,
    image.value.byteLength,
  ) as Buffer<ArrayBuffer>;
  return new Response(body, {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
