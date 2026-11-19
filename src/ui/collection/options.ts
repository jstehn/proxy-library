// What the Game and Real tabs of the collection share: sorts, sections and finish names.

export const SORTS = [
  ["mana", "Mana value"],
  ["name", "Name"],
  ["value", "Most valuable"],
  ["newest", "Newest first"],
  ["set", "Set and number"],
] as const;
export const SORT_VALUES = SORTS.map(([value]) => value);

// Sections divide the page, and the sort orders cards within each (any combination).
export const SECTIONS = [
  ["color", "Sections: colors"],
  ["type", "Sections: card types"],
  ["rarity", "Sections: rarity"],
  ["set", "Sections: sets"],
  ["none", "No sections"],
] as const;
export const SECTION_VALUES = SECTIONS.map(([value]) => value);
export const FINISH_NAMES = { nonfoil: "", foil: "Foil ", etched: "Etched " };

/** Consecutive rows with the same section label, in order (the query already sorted them). */
export function sectionsOf<Row extends { section: string }>(
  rows: readonly Row[],
): Array<{ label: string; rows: Row[] }> {
  const sections: Array<{ label: string; rows: Row[] }> = [];
  for (const row of rows) {
    const last = sections.at(-1);
    if (last !== undefined && last.label === row.section) last.rows.push(row);
    else sections.push({ label: row.section, rows: [row] });
  }
  return sections;
}
