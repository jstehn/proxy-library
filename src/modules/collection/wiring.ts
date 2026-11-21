import { pick } from "@/shared/kernel";
import type { RealCollection } from "./real/application/make-real-collection";

// The real collection's capabilities (ADR 0026): only what callers use.

export function wireRealCollectionCapabilities({
  realCollection,
}: Readonly<{ realCollection: RealCollection }>) {
  return {
    realCollection: pick(
      realCollection,
      "addRealProduct",
      "removeRealProduct",
      "setRealCopies",
      "changeRealPrinting",
      "clearRealCollection",
      "previewImport",
      "applyImport",
      "setRealSharing",
    ),
  };
}
