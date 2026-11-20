import { pick } from "@/shared/kernel";
import type { Drafts } from "./application/drafts";

// The drafts module's capabilities (ADR 0026): only what callers use. The pick timers are for
// the worker, which holds the whole service. `view` stays here because it hides other seats' packs.

export function wireDraftCapabilities({ drafts }: Readonly<{ drafts: Drafts }>) {
  return {
    drafts: pick(
      drafts,
      "createDraft",
      "joinDraft",
      "leaveDraft",
      "startDraft",
      "makePick",
      "pickForAway",
      "answerDeal",
      "endDeals",
      "chooseColor",
      "decideCard",
      "makeDraftDeck",
      "addBot",
      "removeBot",
      "peekWithSneak",
      "watchWithInformant",
      "markPresence",
      "view",
    ),
  };
}
