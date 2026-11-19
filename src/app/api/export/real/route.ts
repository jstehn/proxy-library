import { COLLECTION_EXPORTERS } from "@/modules/collection";
import { readPage } from "@/server/page-instance";

// Downloads your real collection (design doc 16, section 7) in the game collection's formats:
// ?format=moxfield | text | full. "First acquired" is when a row was added, "last" when it changed.

const FILES = {
  moxfield: { type: "text/csv; charset=utf-8", name: "real-collection-moxfield.csv" },
  text: { type: "text/plain; charset=utf-8", name: "real-collection.txt" },
  full: { type: "text/csv; charset=utf-8", name: "real-collection-full.csv" },
} as const;

export async function GET(request: Request): Promise<Response> {
  const { actor, capabilities } = await readPage({ allowVisitors: true });
  if (actor === null) return new Response("Sign in first.", { status: 401 });
  const requested = new URL(request.url).searchParams.get("format");
  const format = requested === "text" || requested === "full" ? requested : "moxfield";

  const rows = await capabilities.realCollectionReads.exportRows(actor.userId);
  return new Response(COLLECTION_EXPORTERS[format](rows), {
    headers: {
      "Content-Type": FILES[format].type,
      "Content-Disposition": `attachment; filename="${FILES[format].name}"`,
      "Cache-Control": "no-store",
    },
  });
}
