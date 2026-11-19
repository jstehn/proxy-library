import { downloadCollection } from "../collection-download";

// Downloads your real collection (design doc 16, section 7) in the game collection's formats.
// "First acquired" is when a row was added, "last" when it changed.
export function GET(request: Request): Promise<Response> {
  return downloadCollection(request, {
    fileName: "real-collection",
    rowsOf: (capabilities, userId) => capabilities.realCollectionReads.exportRows(userId),
  });
}
