import { COLLECTION_EXPORTERS, type ExportRow } from "@/modules/collection";
import { readPage } from "@/server/page-instance";
import type { UserId } from "@/shared/kernel";

// The download both collection exports share (design doc 11, section 3, and doc 16, section 7):
// ?format=moxfield | text | full. Each route says which rows and what to call the files.

const FORMATS = {
  moxfield: { type: "text/csv; charset=utf-8", suffix: "-moxfield.csv" },
  text: { type: "text/plain; charset=utf-8", suffix: ".txt" },
  full: { type: "text/csv; charset=utf-8", suffix: "-full.csv" },
} as const;

type ReadPageResult = Awaited<ReturnType<typeof readPage>>;

export async function downloadCollection(
  request: Request,
  source: Readonly<{
    /** The files' name before the format's ending: "collection" gives "collection-full.csv". */
    fileName: string;
    rowsOf: (
      capabilities: ReadPageResult["capabilities"],
      userId: UserId,
    ) => Promise<readonly ExportRow[]>;
  }>,
): Promise<Response> {
  const { actor, capabilities } = await readPage({ allowVisitors: true });
  if (actor === null) return new Response("Sign in first.", { status: 401 });
  const requested = new URL(request.url).searchParams.get("format");
  const format = requested === "text" || requested === "full" ? requested : "moxfield";

  const rows = await source.rowsOf(capabilities, actor.userId);
  return new Response(COLLECTION_EXPORTERS[format](rows), {
    headers: {
      "Content-Type": FORMATS[format].type,
      "Content-Disposition": `attachment; filename="${source.fileName}${FORMATS[format].suffix}"`,
      "Cache-Control": "no-store",
    },
  });
}
