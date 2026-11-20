import { downloadCollection } from "../collection-download";

// Downloads your collection (design doc 11, section 3).
export function GET(request: Request): Promise<Response> {
  return downloadCollection(request, {
    fileName: "collection",
    rowsOf: (_capabilities, reads, actor) => reads.collection.exportRows(actor),
  });
}
