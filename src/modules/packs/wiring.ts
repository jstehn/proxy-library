import { pickForAdmin } from "@/modules/accounts";
import type { Packs } from "./application/make-packs";

// The packs module's capabilities (ADR 0026): only what callers use.

export function wirePackCapabilities({ packs }: Readonly<{ packs: Packs }>) {
  return { packs: pickForAdmin(packs, "simulateOpenings") };
}
