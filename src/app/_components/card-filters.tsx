import Link from "next/link";

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
  ["M", "Multicolored"],
];
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
}) {
  const value = (name: string) => props.values[name] ?? "";
  return (
    <form method="get" action={props.action} className="flex flex-wrap items-center gap-2">
      <input
        name="name"
        defaultValue={value("name")}
        placeholder="Card name"
        aria-label="Card name"
        className={`${field} w-48`}
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
      <Select
        name="color"
        label="Color"
        value={value("color")}
        anyLabel="Any color"
        options={COLORS}
      />
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
    </form>
  );
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
