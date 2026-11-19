import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { BrowseCard, BrowseSort, BrowseSource } from "@/modules/decks";
import { COLORS, type ManaColor } from "@/shared/kernel";
import { valueOr } from "../answer";
import { browseAction } from "./actions";

// What the collection grid shows: the filters, and the pages of cards found with them. All of it
// belongs to the collection panel, so it lives here and not in the builder's shared state.

const WAIT_MILLISECONDS = 250; // wait for a pause in typing before searching

type BrowseState = Readonly<{
  /** The filters these cards were found with (the grid is loading while they differ). */
  filters: string;
  cards: BrowseCard[];
  page: number;
  pageCount: number;
  total: number;
  notes: readonly string[];
  loadingMore: boolean;
}>;

const EMPTY_BROWSE: BrowseState = {
  filters: "",
  cards: [],
  page: 0,
  pageCount: 1,
  total: 0,
  notes: [],
  loadingMore: false,
};

export const CARD_SIZE_NAMES = ["small", "medium", "large"] as const;
export type CardSize = (typeof CARD_SIZE_NAMES)[number];

export type Browsing = Readonly<{
  source: BrowseSource;
  setSource: (source: BrowseSource) => void;
  search: string;
  setSearch: (update: string | ((current: string) => string)) => void;
  colors: ManaColor[];
  includeColorless: boolean;
  toggleColorless: () => void;
  showEverything: boolean;
  setShowEverything: (value: boolean) => void;
  sort: BrowseSort;
  setSort: (sort: BrowseSort) => void;
  cardSize: CardSize;
  setCardSize: (size: CardSize) => void;
  toggleColor: (color: ManaColor) => void;
  /** Back to the commander's colors. */
  resetToCommanderColors: () => void;
  cards: BrowseCard[];
  total: number;
  notes: readonly string[];
  loadingMore: boolean;
  isFirstPageLoading: boolean;
}>;

export function useBrowse(
  deckId: number,
  isCommanderDeck: boolean,
  commanderColors: ManaColor[] | null,
): readonly [Browsing, RefObject<HTMLDivElement | null>] {
  // What to browse. A Commander deck starts with its commander's colors (design doc 14,
  // decision 2); every other deck starts with every color, and anyone can pick colors.
  const startingColors = (colorsToStart: ManaColor[] | null): ManaColor[] =>
    isCommanderDeck && colorsToStart !== null ? colorsToStart : [...COLORS];
  // The grid always starts on the cards you own; "All cards" searches the whole catalog
  // (design doc 29, decision 1).
  const [source, setSource] = useState<BrowseSource>("mine");
  const [search, setSearch] = useState("");
  const [waitedSearch, setWaitedSearch] = useState("");
  const [colors, setColors] = useState<ManaColor[]>(() => startingColors(commanderColors));
  const [includeColorless, setIncludeColorless] = useState(true);
  const [showEverything, setShowEverything] = useState(false);
  const [sort, setSort] = useState<BrowseSort>("name");
  const [cardSize, setCardSize] = useState<CardSize>("medium");
  const [browse, setBrowse] = useState<BrowseState>(EMPTY_BROWSE);
  const latestBrowse = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);

  // When the commander changes, its colors become the filter (adjusting state while rendering,
  // React's pattern for "reset when a prop changes", rather than in an effect).
  const commanderKey = (commanderColors ?? []).join("");
  const [seenCommanderKey, setSeenCommanderKey] = useState(commanderKey);
  if (commanderKey !== seenCommanderKey) {
    setSeenCommanderKey(commanderKey);
    setColors(startingColors(commanderColors));
  }

  // Wait for a pause in typing before searching.
  useEffect(() => {
    const timer = setTimeout(() => setWaitedSearch(search), WAIT_MILLISECONDS);
    return () => clearTimeout(timer);
  }, [search]);

  const filters = JSON.stringify([
    source,
    waitedSearch,
    colors,
    includeColorless,
    showEverything,
    sort,
  ]);

  /** Loads one page of the collection; page 1 replaces the grid, later pages add to it. */
  const loadPage = useCallback(
    (page: number) => {
      const request = ++latestBrowse.current;
      const everyColor = colors.length === COLORS.length && includeColorless;
      void browseAction({
        deckId,
        source,
        search: waitedSearch,
        colors: showEverything || everyColor ? null : colors,
        includeColorless,
        onlyLegal: !showEverything,
        sort,
        page,
      }).then((answer) => {
        if (request !== latestBrowse.current) return; // a newer search has started
        const result = valueOr(answer, null);
        if (result === null) {
          setBrowse({ ...EMPTY_BROWSE, filters });
          return;
        }
        setBrowse((current) => ({
          filters,
          cards: page === 1 ? [...result.cards] : [...current.cards, ...result.cards],
          page,
          pageCount: result.pageCount,
          total: result.total,
          notes: result.notes,
          loadingMore: false,
        }));
      });
    },
    [deckId, filters, source, waitedSearch, colors, includeColorless, showEverything, sort],
  );

  useEffect(() => loadPage(1), [loadPage]);
  const isFirstPageLoading = browse.filters !== filters;

  // Infinite scroll: when the end of the grid comes into view, load the next page.
  useEffect(() => {
    const end = endRef.current;
    if (end === null) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const more = browse.page < browse.pageCount;
        const idle = !browse.loadingMore && !isFirstPageLoading;
        if (entries.some((entry) => entry.isIntersecting) && more && idle) {
          setBrowse((current) => ({ ...current, loadingMore: true }));
          loadPage(browse.page + 1);
        }
      },
      { rootMargin: "600px" },
    );
    observer.observe(end);
    return () => observer.disconnect();
  }, [browse.page, browse.pageCount, browse.loadingMore, isFirstPageLoading, loadPage]);

  function toggleColor(color: ManaColor) {
    setShowEverything(false);
    setColors((current) =>
      current.includes(color)
        ? current.filter((other) => other !== color)
        : COLORS.filter((other) => other === color || current.includes(other)),
    );
  }

  // The ref goes on an element after the grid: when it comes into view, the next page loads.
  const browsing: Browsing = {
    source,
    setSource,
    search,
    setSearch,
    colors,
    includeColorless,
    toggleColorless: () => {
      setShowEverything(false);
      setIncludeColorless((value) => !value);
    },
    showEverything,
    setShowEverything,
    sort,
    setSort,
    cardSize,
    setCardSize,
    toggleColor,
    resetToCommanderColors: () => {
      setShowEverything(false);
      setColors(startingColors(commanderColors));
    },
    cards: browse.cards,
    total: browse.total,
    notes: browse.notes,
    loadingMore: browse.loadingMore,
    isFirstPageLoading,
  };
  return [browsing, endRef];
}
