import Link from "next/link";
import { COLOR_COMBINATIONS } from "@/shared/kernel";

// The filter bar shared by the collection and the singles store. A plain GET form: the filters
// live in the URL, so a view can be bookmarked, shared, and reached with the back button.

export type FilterValues = Readonly<Record<string, string>>;

const RARITIES = ["common", "uncommon", "rare", "mythic", "special", "bonus"];
const COLORS: Array<[string, string]> = [
  ["W", "White"],
  ["U", "Blue"],
  ["B", "Black"],
  ["R", "Red"],
  ["G", "Green"],
  ["C", "Colorless"],
  ["M", "Multicolored (any)"],
];
/** Each multicolored combination, grouped by how many colors it has. */
const COMBINATION_GROUPS = [
  { label: "Two colors", size: 2 },
  { label: "Three colors", size: 3 },
  { label: "Four or five colors", size: 4 },
].map((group) => ({
  label: group.label,
  combinations: COLOR_COMBINATIONS.filter((combination) =>
    group.size === 4 ? combination.colors.length >= 4 : combination.colors.length === group.size,
  ),
}));
const FINISHES: Array<[string, string]> = [
  ["nonfoil", "Nonfoil"],
  ["foil", "Foil"],
  ["etched", "Etched"],
];

const field =
  "rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700";

function Select(props: {
  name: string;
  label: string;
  value: string;
  options: ReadonlyArray<readonly [string, string]>;
  anyLabel?: string;
}) {
  return (
    <select name={props.name} defaultValue={props.value} aria-label={props.label} className={field}>
      {props.anyLabel !== undefined && <option value="">{props.anyLabel}</option>}
      {props.options.map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </select>
  );
}

export function CardFilters(props: {
  action: string;
  values: FilterValues;
  sets: ReadonlyArray<{ code: string; name: string }>;
  sorts: ReadonlyArray<readonly [string, string]>;
  /** Ways to divide the results into sections, if the page has them. */
  sections?: ReadonlyArray<readonly [string, string]>;
  showFinish?: boolean;
  /** Parts of the search that were ignored, shown under the form. */
  notes?: readonly string[];
}) {
  const value = (name: string) => props.values[name] ?? "";
  return (
    <form method="get" action={props.action} className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          name="q"
          defaultValue={searchText(props.values)}
          placeholder="Search: bolt, t:creature mv<=2, kw:flying, is:showcase"
          aria-label="Search cards"
          className={`${field} w-full sm:w-80`}
        />
        <Select
          name="set"
          label="Set"
          value={value("set")}
          anyLabel="Any set"
          options={props.sets.map((set) => [set.code, `${set.name} (${set.code})`] as const)}
        />
        <Select
          name="rarity"
          label="Rarity"
          value={value("rarity")}
          anyLabel="Any rarity"
          options={RARITIES.map((rarity) => [rarity, rarity] as const)}
        />
        <select name="color" defaultValue={value("color")} aria-label="Color" className={field}>
          <option value="">Any color</option>
          {COLORS.map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
          {COMBINATION_GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.combinations.map((combination) => (
                <option key={combination.code} value={combination.code}>
                  {combination.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {props.showFinish && (
          <Select
            name="finish"
            label="Finish"
            value={value("finish")}
            anyLabel="Any finish"
            options={FINISHES}
          />
        )}
        {props.sections && (
          <Select
            name="sections"
            label="Sections"
            value={value("sections")}
            options={props.sections}
          />
        )}
        <Select name="sort" label="Sort by" value={value("sort")} options={props.sorts} />
        <button
          type="submit"
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Show
        </button>
        <Link href={props.action} className="text-sm underline">
          Clear
        </Link>
        <Link href="/search-help" className="text-sm underline">
          Search help
        </Link>
      </div>
      {props.notes !== undefined && props.notes.length > 0 && (
        <ul className="text-xs text-amber-700 dark:text-amber-400">
          {props.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </form>
  );
}

/** The search text from the URL: `q`, or `name` from links made before design doc 15. */
export function searchText(values: FilterValues): string {
  return values.q ?? values.name ?? "";
}

/** Previous and next page links that keep the current filters. */
export function Pagination(props: {
  action: string;
  values: FilterValues;
  page: number;
  pageCount: number;
}) {
  if (props.pageCount <= 1) return null;
  const hrefFor = (page: number) => {
    const params = new URLSearchParams({ ...props.values, page: String(page) });
    return `${props.action}?${params.toString()}`;
  };
  return (
    <nav aria-label="Pages" className="flex items-center gap-4 text-sm">
      {props.page > 1 ? <Link href={hrefFor(props.page - 1)}>← Previous</Link> : <span />}
      <span className="text-zinc-500">
        Page {props.page} of {props.pageCount}
      </span>
      {props.page < props.pageCount && <Link href={hrefFor(props.page + 1)}>Next →</Link>}
    </nav>
  );
}

/** The search params as plain strings (first value of each), without empty ones. */
export function filterValues(
  searchParams: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, raw] of Object.entries(searchParams)) {
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value !== undefined && value !== "" && key !== "page") values[key] = value;
  }
  return values;
}

/** A page number from the URL: a whole number from 1, anything else is 1. */
export function pageNumber(searchParams: Record<string, string | string[] | undefined>): number {
  const page = Number(Array.isArray(searchParams.page) ? searchParams.page[0] : searchParams.page);
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

/** One of the allowed values, or the first allowed value. */
export function oneOf<T extends string>(value: string | undefined, allowed: readonly T[]): T {
  return allowed.find((option) => option === value) ?? allowed[0];
}
