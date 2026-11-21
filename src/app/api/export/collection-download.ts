import type { Actor } from "@/modules/accounts";
import { COLLECTION_EXPORTERS, type ExportRow } from "@/modules/collection";
import type { Reads } from "@/server/reads";
import { readPage } from "@/server/page-instance";

// The download both collection exports share (design doc 11, section 3, and doc 16, section 7):
// ?format=moxfield | text | full. Each route says which rows and what to call the files.

const FORMATS = {
  moxfield: { type: "text/csv; charset=utf-8", suffix: "-moxfield.csv" },
  text: { type: "text/plain; charset=utf-8", suffix: ".txt" },
  full: { type: "text/csv; charset=utf-8", suffix: "-full.csv" },
} as const;

export async function downloadCollection(
  request: Request,
  source: Readonly<{
    /** The files' name before the format's ending: "collection" gives "collection-full.csv". */
    fileName: string;
    rowsOf: (reads: Reads, actor: Actor) => Promise<readonly ExportRow[]>;
  }>,
): Promise<Response> {
  const { actor, reads } = await readPage({ allowVisitors: true });
  if (actor === null) return new Response("Sign in first.", { status: 401 });
  const requested = new URL(request.url).searchParams.get("format");
  const format = requested === "text" || requested === "full" ? requested : "moxfield";

  const rows = await source.rowsOf(reads, actor);
  return new Response(COLLECTION_EXPORTERS[format](rows), {
    headers: {
      "Content-Type": FORMATS[format].type,
      "Content-Disposition": `attachment; filename="${source.fileName}${FORMATS[format].suffix}"`,
      "Cache-Control": "no-store",
    },
  });
}
