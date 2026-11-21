import { COMMANDER_SORTS, type CommanderSort } from "@/modules/decks";
import { canonicalTheme } from "@/shared/card-search";
import { COLORS, type ManaColor, type Theme } from "@/shared/kernel";

// What Find a commander reads from the address (`?colors=…&theme=…`) and how it writes it back.

type Param = string | string[] | undefined;

/** How many rows each "Show more" adds. */
export const PAGE = 25;

export const COMMANDERS_PATH = "/decks/commanders";

export type CommanderFilters = Readonly<{
  colors: ManaColor[];
  theme: Theme | undefined;
  tribe: string;
  sort: CommanderSort;
  includeStore: boolean;
  withReal: boolean;
}>;

function firstParam(value: Param): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

function chosenColors(value: Param): ManaColor[] {
  const text = Array.isArray(value) ? value.join("") : (value ?? "");
  return COLORS.filter((color) => text.includes(color));
}

function chosenSort(value: Param): CommanderSort {
  const raw = firstParam(value);
  return (COMMANDER_SORTS as readonly string[]).includes(raw) ? (raw as CommanderSort) : "coverage";
}

function chosenTheme(value: Param): Theme | undefined {
  const raw = firstParam(value);
  if (raw === "") return undefined;
  return canonicalTheme(raw) ?? undefined;
}

/** The filters in the address, and how many rows to show. */
export function readFilters(searchParams: Record<string, Param>) {
  const filters: CommanderFilters = {
    colors: chosenColors(searchParams.colors),
    theme: chosenTheme(searchParams.theme),
    tribe: firstParam(searchParams.tribe),
    sort: chosenSort(searchParams.sort),
    includeStore: searchParams.store === "1",
    withReal: searchParams.real === "1",
  };
  const shown = Math.max(PAGE, Number(searchParams.show) || PAGE);
  return { filters, shown };
}

export type UrlOverrides = Readonly<{
  show?: number;
  theme?: Theme | "";
  tribe?: string;
  sort?: CommanderSort;
}>;

/** The address with the current filters, except what `overrides` changes. */
export function commandersUrl(filters: CommanderFilters, overrides: UrlOverrides): string {
  const params = new URLSearchParams();
  if (filters.colors.length > 0) params.set("colors", filters.colors.join(""));
  const theme = overrides.theme !== undefined ? overrides.theme : (filters.theme ?? "");
  if (theme !== "") params.set("theme", theme);
  const tribe = overrides.tribe !== undefined ? overrides.tribe : filters.tribe;
  if (tribe !== "") params.set("tribe", tribe);
  const sort = overrides.sort ?? filters.sort;
  if (sort !== "coverage") params.set("sort", sort);
  if (filters.includeStore) params.set("store", "1");
  if (filters.withReal) params.set("real", "1");
  if (overrides.show !== undefined && overrides.show > PAGE) {
    params.set("show", String(overrides.show));
  }
  const queryString = params.toString();
  return queryString === "" ? COMMANDERS_PATH : `${COMMANDERS_PATH}?${queryString}`;
}
