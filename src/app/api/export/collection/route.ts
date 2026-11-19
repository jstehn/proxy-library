import { COLLECTION_EXPORTERS } from "@/modules/collection";
import { readPage } from "@/server/page-instance";

// Downloads your collection (design doc 11, section 3): ?format=moxfield | text | full.

const FILES = {
  moxfield: { type: "text/csv; charset=utf-8", name: "collection-moxfield.csv" },
  text: { type: "text/plain; charset=utf-8", name: "collection.txt" },
  full: { type: "text/csv; charset=utf-8", name: "collection-full.csv" },
} as const;

export async function GET(request: Request): Promise<Response> {
  const { actor, capabilities } = await readPage({ allowVisitors: true });
  if (actor === null) return new Response("Sign in first.", { status: 401 });
  const requested = new URL(request.url).searchParams.get("format");
  const format = requested === "text" || requested === "full" ? requested : "moxfield";

  const rows = await capabilities.collectionReads.exportRows(actor.userId);
  return new Response(COLLECTION_EXPORTERS[format](rows), {
    headers: {
      "Content-Type": FILES[format].type,
      "Content-Disposition": `attachment; filename="${FILES[format].name}"`,
      "Cache-Control": "no-store",
    },
  });
}
