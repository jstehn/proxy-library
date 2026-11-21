import { hasTypeWord, isLand } from "@/shared/mtg";
import type { Recognizer } from "../types";

// Moved from the `is:` land cycles in shared/card-search/sql.ts (design doc 28, section 3.6),
// with the same patterns. Each pattern is tried on the rules text without reminder text.
const REMINDER = /\([^)]*\)/g;
const TAPPED = String.raw`enters( the battlefield)? tapped`;
const BASIC = String.raw`(plains|island|swamp|mountain|forest)`;
const THEN_ENTERS = String.raw`${TAPPED}\.\s*when [^.]*enters( the battlefield)?, `;
const FETCH = String.raw`pay 1 life, sacrifice [^:]*: search your library for an? \w+ or \w+ card`;
const BASIC_TYPES = ["Plains", "Island", "Swamp", "Mountain", "Forest"];

/** The cycles told apart by their rules text alone. */
const TEXT_CYCLES: ReadonlyArray<readonly [string, string]> = [
  ["fetchland", FETCH],
  ["checkland", `${TAPPED} unless you control an? ${BASIC} or an? ${BASIC}`],
  ["fastland", `${TAPPED} unless you control two or fewer other lands`],
  ["slowland", `${TAPPED} unless you control two or more other lands`],
  ["painland", String.raw`\{T\}: add \{[WUBRG]\} or \{[WUBRG]\}\.[^.\n]*deals 1 damage to you`],
  ["bounceland", "return a land you control to its owner's hand"],
  ["scryland", `${THEN_ENTERS}scry 1`],
  ["gainland", `${THEN_ENTERS}you gain 1 life`],
  ["manland", String.raw`becomes an? [^.]*creature`],
];

export const landCycles: Recognizer<"landCycles"> = {
  id: "land-cycles",
  field: "landCycles",
  recognize(card) {
    // A double-faced card with a land face is a land (decision 1), so the faces are read together.
    const typeLine = card.faces.map((face) => face.typeLine).join(" // ");
    if (!isLand(typeLine)) return [];
    const text = card.faces.map((face) => face.text.replace(REMINDER, "")).join("\n");
    const basics = BASIC_TYPES.filter((type) => hasTypeWord(typeLine, [type])).length;
    const cycles = basics >= 1 ? ["fetchable"] : [];
    const cycling = card.keywords.some((keyword) => keyword.toLowerCase() === "cycling");
    if (basics === 2 && text.trim() === "" && !hasTypeWord(typeLine, ["Basic"]))
      cycles.push("dual");
    if (basics === 2 && /you may pay 2 life/i.test(text)) cycles.push("shockland");
    if (basics === 2 && cycling) cycles.push("cycleland");
    if (basics === 3) cycles.push("triome");
    if (typeLine === "Land // Land") cycles.push("pathway");
    for (const [cycle, pattern] of TEXT_CYCLES) {
      if (new RegExp(pattern, "i").test(text)) cycles.push(cycle);
    }
    return cycles;
  },
};
