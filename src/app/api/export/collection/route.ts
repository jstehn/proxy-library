import { COLLECTION_EXPORTERS, exportRows } from "@/modules/collection";
import { getContainer } from "@/server/container";
import { getCurrentActor } from "@/server/session";

// Downloads your collection (design doc 11, section 3): ?format=moxfield | text | full.

const FILES = {
  moxfield: { type: "text/csv; charset=utf-8", name: "collection-moxfield.csv" },
  text: { type: "text/plain; charset=utf-8", name: "collection.txt" },
  full: { type: "text/csv; charset=utf-8", name: "collection-full.csv" },
} as const;

export async function GET(request: Request): Promise<Response> {
  const actor = await getCurrentActor();
  if (actor === null) return new Response("Sign in first.", { status: 401 });
  const requested = new URL(request.url).searchParams.get("format");
  const format = requested === "text" || requested === "full" ? requested : "moxfield";

  const rows = await exportRows(getContainer().db, actor.userId);
  return new Response(COLLECTION_EXPORTERS[format](rows), {
    headers: {
      "Content-Type": FILES[format].type,
      "Content-Disposition": `attachment; filename="${FILES[format].name}"`,
      "Cache-Control": "no-store",
    },
  });
}
