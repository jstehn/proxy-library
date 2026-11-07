import {
  PrintingId,
  SealedProductId,
  SetCode,
  type Finish,
  type SealedContent,
} from "@/modules/catalog";

// Sealed contents for tests (domain tests can't call the catalog's constructors themselves).

export const sampleContent = {
  pack: (setCode: string, boosterType: string): SealedContent => ({
    kind: "pack",
    setCode: SetCode.of(setCode),
    boosterType,
  }),
  card: (printingId: string, finish: Finish): SealedContent => ({
    kind: "card",
    printingId: PrintingId.of(printingId),
    finish,
  }),
  deck: (setCode: string, deckName: string): SealedContent => ({
    kind: "deck",
    setCode: SetCode.of(setCode),
    deckName,
  }),
  sealed: (productId: string, count: number): SealedContent => ({
    kind: "sealed",
    productId: SealedProductId.of(productId),
    count,
  }),
};
