import type { LandFetch, Recognizer } from "../types";

// A spell that puts a land from the library onto the battlefield (Rampant Growth, Cultivate,
// Three Visits): whether the land comes in tapped, and which basic land types it may fetch. A
// fetch that is an activated ability ("Sacrifice ~: search …") is not one: it costs the card.
const FETCH =
  /(?<!:\s*)search your library for ([^.]*?)\bcards?\b[^.]*?onto the battlefield( tapped)?/i;
const LAND_TYPE_COLORS = [
  ["plains", "W"],
  ["island", "U"],
  ["swamp", "B"],
  ["mountain", "R"],
  ["forest", "G"],
] as const;

export const landFetch: Recognizer<"landFetch"> = {
  id: "land-fetch",
  field: "landFetch",
  recognize(card): LandFetch | null {
    const text = card.faces.map((face) => face.text).join("\n");
    const match = FETCH.exec(text);
    if (match === null) return null;
    const sought = match[1].toLowerCase();
    const named = LAND_TYPE_COLORS.filter(([type]) => sought.includes(type));
    if (named.length === 0 && !sought.includes("land")) return null;
    const fetched = named.length > 0 ? named : LAND_TYPE_COLORS;
    return { entersTapped: match[2] !== undefined, colors: fetched.map(([, color]) => color) };
  },
};
