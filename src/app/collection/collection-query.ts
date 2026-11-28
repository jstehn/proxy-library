import {
  filterValues,
  oneOf,
  pageNumber,
  searchText,
  type FilterValues,
} from "@/app/_components/card-filters";
import type { CollectionFilter } from "@/modules/collection";
import { SECTION_VALUES, SORT_VALUES } from "@/app/collection/options";

/** What the address of a collection page (the game's, the real one, someone else's) asks for. */
export type CollectionQuery = Readonly<{
  /** The raw filter fields, for the filter form and the page links. */
  values: FilterValues;
  page: number;
  /** The same, as the query's filter. */
  filter: CollectionFilter;
  /** Whether any filter is on, so the totals can say so. */
  isFiltered: boolean;
}>;

export function readCollectionQuery(
  searchParams: Record<string, string | string[] | undefined>,
): CollectionQuery {
  const values = filterValues(searchParams);
  const page = pageNumber(searchParams);
  const finish = oneOf(values.finish, ["", "nonfoil", "foil", "etched"] as const);
  return {
    values,
    page,
    filter: {
      search: searchText(values),
      setCode: values.set,
      rarity: values.rarity,
      color: values.color,
      finish: finish === "" ? undefined : finish,
      sections: oneOf(values.sections, SECTION_VALUES),
      sort: oneOf(values.sort, SORT_VALUES),
      page,
      stackPrintings: true,
    },
    isFiltered: ["q", "name", "set", "rarity", "color", "finish"].some((key) => key in values),
  };
}
