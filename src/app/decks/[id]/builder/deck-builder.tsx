"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { PrintingCard } from "@/modules/catalog";
import type { Board, BrowseCard, BrowseSort, DeckLine } from "@/modules/decks";
import { hasTerm, mainType, toggleTerm } from "@/modules/decks/client";
import { ManaText } from "@/ui/mana";
import { browseAction, cardDetailAction, setQuantityAction, type BuilderDeck } from "./actions";
import { DeckList } from "./deck-list";
import { SelectedCard, type Selection } from "./selected-card";
import { StatsPanel } from "./stats-panel";

// The deck builder (design doc 14, section 2): your collection as card images on the left, the
// deck and its live statistics on the right. On a phone, two tabs. The deck lives in this
// component's state so the statistics change instantly; each change is saved by a server action,
// which sends back the deck as the server now has it.

type Color = "W" | "U" | "B" | "R" | "G";
const COLORS: readonly Color[] = ["W", "U", "B", "R", "G"];
const WAIT_MILLISECONDS = 250; // wait for a pause in typing before searching

const SORT_LABELS: Readonly<Record<BrowseSort, string>> = {
  name: "Name",
  manaValue: "Mana value",
  color: "Color",
  type: "Type",
  newest: "Newest",
};

/** Quick filters: each button adds or removes a term in the search box. */
const TYPE_FILTERS = [
  "Creature",
  "Instant",
  "Sorcery",
  "Artifact",
  "Enchantment",
  "Planeswalker",
  "Land",
] as const;
const MANA_VALUE_FILTERS = ["mv=0", "mv=1", "mv=2", "mv=3", "mv=4", "mv=5", "mv=6", "mv>=7"];
const MANA_VALUE_FAMILY = /^(mv|cmc)[<>=:!]/i;

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

export function DeckBuilder(props: { deckId: number; format: string; initialDeck: BuilderDeck }) {
  const { deckId, format } = props;
  const isCommanderDeck = format === "commander";
  const [deck, setDeck] = useState(props.initialDeck);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [isSaving, startSaving] = useTransition();
  const latestChange = useRef(0);

  // What to browse. A Commander deck starts with its commander's colors (design doc 14,
  // decision 2); every other deck starts with every color, and anyone can pick colors.
  const startingColors = (colors: BuilderDeck["commanderColors"]): Color[] =>
    isCommanderDeck && colors !== null ? colors : [...COLORS];
  const [search, setSearch] = useState("");
  const [waitedSearch, setWaitedSearch] = useState("");
  const [colors, setColors] = useState<Color[]>(() => startingColors(deck.commanderColors));
  const [includeColorless, setIncludeColorless] = useState(true);
  const [showEverything, setShowEverything] = useState(false);
  const [sort, setSort] = useState<BrowseSort>("name");
  const [browse, setBrowse] = useState<BrowseState>(EMPTY_BROWSE);
  const latestBrowse = useRef(0);

  // When the commander changes, its colors become the filter (adjusting state while rendering,
  // React's pattern for "reset when a prop changes", rather than in an effect).
  const commanderKey = (deck.commanderColors ?? []).join("");
  const [seenCommanderKey, setSeenCommanderKey] = useState(commanderKey);
  if (commanderKey !== seenCommanderKey) {
    setSeenCommanderKey(commanderKey);
    setColors(startingColors(deck.commanderColors));
  }

  const [selected, setSelected] = useState<Selection | null>(null);
  const selectedPrinting = useRef<string | null>(null);
  const [detail, setDetail] = useState<PrintingCard | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [tab, setTab] = useState<"collection" | "deck">("collection");
  const searchRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLUListElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Wait for a pause in typing before searching.
  useEffect(() => {
    const timer = setTimeout(() => setWaitedSearch(search), WAIT_MILLISECONDS);
    return () => clearTimeout(timer);
  }, [search]);

  const filters = JSON.stringify([waitedSearch, colors, includeColorless, showEverything, sort]);

  /** Loads one page of the collection; page 1 replaces the grid, later pages add to it. */
  const loadPage = useCallback(
    (page: number) => {
      const request = ++latestBrowse.current;
      const everyColor = colors.length === COLORS.length && includeColorless;
      void browseAction({
        deckId,
        search: waitedSearch,
        colors: showEverything || everyColor ? null : colors,
        includeColorless,
        onlyLegal: !showEverything,
        sort,
        page,
      }).then((result) => {
        if (request !== latestBrowse.current) return; // a newer search has started
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
    [deckId, filters, waitedSearch, colors, includeColorless, showEverything, sort],
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

  // "/" jumps to the search box from anywhere on the page, as on Scryfall and GitHub.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = target?.closest("input, textarea, select") !== null;
      if (event.key === "/" && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** Copies of each card in this deck, per board, from the deck in hand. */
  function inDeck(oracleId: string): Partial<Record<Board, number>> {
    const counts: Partial<Record<Board, number>> = {};
    for (const line of deck.lines) {
      if (line.oracleId === oracleId) counts[line.board] = line.quantity;
    }
    return counts;
  }
  const totalInDeck = (oracleId: string) =>
    Object.values(inDeck(oracleId)).reduce((sum, count) => sum + (count ?? 0), 0);

  function select(selection: Selection) {
    selectedPrinting.current = selection.printingId;
    setSelected(selection);
    setQuantity(1);
    const known = deck.cards[selection.printingId];
    setDetail(known ?? null);
    if (known === undefined) {
      void cardDetailAction(selection.printingId).then((card) => {
        // Only if the same card is still selected when the answer arrives.
        if (selectedPrinting.current === selection.printingId) setDetail(card);
      });
    }
  }

  function selectFromGrid(card: BrowseCard) {
    select({
      oracleId: card.oracleId,
      printingId: card.printingId,
      name: card.name,
      owned: card.owned,
      inDeck: inDeck(card.oracleId),
      otherDecks: card.otherDecks,
      misfit: card.misfit,
    });
  }

  function selectFromDeck(line: DeckLine) {
    select({
      oracleId: line.oracleId,
      printingId: line.printingId,
      name: line.name,
      owned: line.owned,
      inDeck: inDeck(line.oracleId),
      otherDecks: line.otherDecks.length,
      misfit: null,
    });
  }

  /** Saves a new quantity for one card on one board; the deck updates at once where it can. */
  function saveQuantity(
    change: { oracleId: string; printingId?: string; board: Board; quantity: number },
    done: string,
  ) {
    const request = ++latestChange.current;
    // Show the change straight away for cards already in the deck; new cards appear when the
    // server answers (it knows their details).
    setDeck((current) => ({
      ...current,
      lines: current.lines
        .map((line) =>
          line.oracleId === change.oracleId && line.board === change.board
            ? { ...line, quantity: change.quantity }
            : line,
        )
        .filter((line) => line.quantity > 0),
    }));
    startSaving(async () => {
      const result = await setQuantityAction({ deckId, ...change });
      if (request !== latestChange.current) return; // a later change will bring the fresh deck
      if (result.ok) {
        setDeck(result.deck);
        setMessage({ tone: "ok", text: done });
      } else {
        setMessage({ tone: "error", text: result.message });
      }
    });
  }

  function add(board: Board) {
    if (selected === null) return;
    const current = inDeck(selected.oracleId)[board] ?? 0;
    const next = board === "commander" ? 1 : Math.min(99, current + quantity);
    const added = next - current;
    saveQuantity(
      { oracleId: selected.oracleId, printingId: selected.printingId, board, quantity: next },
      board === "commander"
        ? `${selected.name} is now a commander.`
        : `Added ${added} ${selected.name} (now ${next}${board === "side" ? " in the sideboard" : ""}${added < quantity ? ", the most one line can hold" : ""}).`,
    );
    setSelected({ ...selected, inDeck: { ...selected.inDeck, [board]: next } });
  }

  function changeLine(line: DeckLine, next: number) {
    saveQuantity(
      { oracleId: line.oracleId, board: line.board, quantity: Math.max(0, Math.min(99, next)) },
      next <= 0 ? `Removed ${line.name}.` : `${line.name}: now ${next}.`,
    );
  }

  /** Arrow keys move the selection through the grid by position, so rows of any width work. */
  function onGridKey(event: React.KeyboardEvent) {
    const buttons = [...(gridRef.current?.querySelectorAll<HTMLElement>("[data-card]") ?? [])];
    const index = buttons.findIndex((button) => button === document.activeElement);
    if (index === -1) return;
    const card = browse.cards[index];
    if (event.key === "Enter") {
      event.preventDefault();
      if (selected?.oracleId === card.oracleId) add("main");
      else selectFromGrid(card);
      return;
    }
    if (event.key === "+" || event.key === "=") {
      setQuantity((value) => Math.min(99, value + 1));
      return;
    }
    if (event.key === "-") {
      setQuantity((value) => Math.max(1, value - 1));
      return;
    }
    const target = nextByPosition(buttons, index, event.key);
    if (target === null) return;
    event.preventDefault();
    buttons[target].focus();
    selectFromGrid(browse.cards[target]);
  }

  function toggleColor(color: Color) {
    setShowEverything(false);
    setColors((current) =>
      current.includes(color)
        ? current.filter((other) => other !== color)
        : COLORS.filter((other) => other === color || current.includes(other)),
    );
  }

  const problemsByName = new Map<string, string[]>();
  for (const problem of deck.problems) {
    if (problem.name !== null) {
      problemsByName.set(problem.name, [...(problemsByName.get(problem.name) ?? []), problem.text]);
    }
  }
  const deckProblems = deck.problems.filter((problem) => problem.name === null);
  const cardTotal = deck.lines.reduce((sum, line) => sum + line.quantity, 0);
  const pill = (pressed: boolean) =>
    `rounded-full px-2.5 py-0.5 text-xs ${pressed ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-zinc-300 dark:border-zinc-700"}`;

  return (
    <div className="flex flex-col gap-4">
      {/* Phone: two tabs. Wide screens show both sides at once. */}
      <div role="tablist" aria-label="Builder" className="flex gap-2 lg:hidden">
        {(["collection", "deck"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={tab === option}
            onClick={() => setTab(option)}
            className={`flex-1 rounded-md py-1.5 text-sm ${tab === option ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-zinc-300 dark:border-zinc-700"}`}
          >
            {option === "collection" ? "Collection" : `Deck (${cardTotal})`}
          </button>
        ))}
      </div>

      <p role="status" className="min-h-5 text-sm">
        {message && (
          <span
            className={
              message.tone === "ok"
                ? "text-green-700 dark:text-green-400"
                : "text-red-700 dark:text-red-400"
            }
          >
            {message.text}
          </span>
        )}
      </p>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <section
          aria-label="Your collection"
          className={`min-w-0 flex-1 flex-col gap-3 ${tab === "collection" ? "flex" : "hidden lg:flex"}`}
        >
          <div className="flex flex-col gap-2">
            <input
              ref={searchRef}
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Search your cards"
              placeholder='Search: bolt, t:creature mv<=3, o:"draw a card", id<=esper'
              className="rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
            />
            {browse.notes.length > 0 && (
              <ul className="text-xs text-amber-700 dark:text-amber-400">
                {browse.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}
            <div
              className="flex flex-wrap items-center gap-1.5"
              aria-label="Colors shown"
              role="group"
            >
              {COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-pressed={!showEverything && colors.includes(color)}
                  aria-label={`Show ${COLOR_NAMES[color]} cards`}
                  onClick={() => toggleColor(color)}
                  className={`rounded-full p-0.5 ${!showEverything && colors.includes(color) ? "ring-2 ring-zinc-900 dark:ring-zinc-100" : "opacity-35"}`}
                >
                  <ManaText text={`{${color}}`} />
                </button>
              ))}
              <button
                type="button"
                aria-pressed={!showEverything && includeColorless}
                aria-label="Show colorless cards"
                onClick={() => {
                  setShowEverything(false);
                  setIncludeColorless((value) => !value);
                }}
                className={`rounded-full p-0.5 ${!showEverything && includeColorless ? "ring-2 ring-zinc-900 dark:ring-zinc-100" : "opacity-35"}`}
              >
                <ManaText text="{C}" />
              </button>
              {isCommanderDeck && deck.commanderColors !== null && (
                <button
                  type="button"
                  className="text-xs underline"
                  onClick={() => {
                    setShowEverything(false);
                    setColors(startingColors(deck.commanderColors));
                  }}
                >
                  Commander&apos;s colors
                </button>
              )}
              <label className="ml-auto flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={showEverything}
                  onChange={(event) => setShowEverything(event.target.checked)}
                />
                Show everything I own
              </label>
            </div>
            <div
              className="flex flex-wrap items-center gap-1.5"
              role="group"
              aria-label="Quick filters"
            >
              {TYPE_FILTERS.map((type) => {
                const term = `t:${type.toLowerCase()}`;
                return (
                  <button
                    key={type}
                    type="button"
                    aria-pressed={hasTerm(search, term)}
                    onClick={() => setSearch((current) => toggleTerm(current, term))}
                    className={pill(hasTerm(search, term))}
                  >
                    {type}
                  </button>
                );
              })}
              <span className="mx-1 text-xs text-zinc-500">Mana value</span>
              {MANA_VALUE_FILTERS.map((term) => (
                <button
                  key={term}
                  type="button"
                  aria-pressed={hasTerm(search, term)}
                  aria-label={`Mana value ${term.slice(2)}`}
                  onClick={() =>
                    setSearch((current) => toggleTerm(current, term, MANA_VALUE_FAMILY))
                  }
                  className={pill(hasTerm(search, term))}
                >
                  {term === "mv>=7" ? "7+" : term.slice(3)}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
              <span aria-live="polite">
                {isFirstPageLoading
                  ? "Loading…"
                  : `${browse.total} ${browse.total === 1 ? "card" : "cards"}`}
              </span>
              <label className="flex items-center gap-1">
                Sort
                <select
                  value={sort}
                  onChange={(event) => setSort(event.target.value as BrowseSort)}
                  className="rounded border border-zinc-300 bg-transparent px-1 py-0.5 dark:border-zinc-700"
                >
                  {Object.entries(SORT_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <ul
            ref={gridRef}
            onKeyDown={onGridKey}
            aria-label="Cards you own"
            className={`grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2 transition-opacity ${isFirstPageLoading && browse.cards.length > 0 ? "opacity-60" : ""}`}
          >
            {browse.cards.map((card, index) => {
              const heading =
                sort === "type" &&
                (index === 0 ||
                  mainType(browse.cards[index - 1].typeLine) !== mainType(card.typeLine));
              const count = totalInDeck(card.oracleId);
              const isSelected = selected?.oracleId === card.oracleId;
              return (
                <GridCard
                  key={card.oracleId}
                  card={card}
                  heading={heading ? mainType(card.typeLine) : null}
                  inThisDeck={count}
                  isSelected={isSelected}
                  onSelect={() => selectFromGrid(card)}
                />
              );
            })}
          </ul>
          {!isFirstPageLoading && browse.cards.length === 0 && (
            <p className="text-sm text-zinc-500">
              None of your cards match. Try fewer filters, or &quot;Show everything I own&quot;.
            </p>
          )}
          <div ref={endRef} className="h-1" />
          {browse.loadingMore && <p className="text-center text-xs text-zinc-500">Loading more…</p>}

          {selected !== null && (
            // Stays at the bottom of the screen while the grid scrolls: a sheet on a phone.
            <div className="sticky bottom-2 z-10 max-h-[70vh] overflow-y-auto rounded-lg shadow-xl">
              <SelectedCard
                selection={{ ...selected, inDeck: inDeck(selected.oracleId) }}
                detail={detail}
                quantity={quantity}
                onQuantity={setQuantity}
                onAdd={add}
                isCommanderDeck={isCommanderDeck}
                onClose={() => setSelected(null)}
              />
            </div>
          )}
        </section>

        <aside
          aria-label="The deck"
          className={`w-full flex-col gap-6 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:w-[26rem] lg:overflow-y-auto lg:pr-1 ${tab === "deck" ? "flex" : "hidden lg:flex"}`}
        >
          <section aria-label="Problems" className="flex flex-col gap-1 text-sm">
            {deck.problems.length === 0 ? (
              <p className="text-green-700 dark:text-green-400">
                {cardTotal === 0
                  ? "Empty so far."
                  : "Ready to play: you own everything, and it follows the format's rules."}
              </p>
            ) : (
              <ul className="flex flex-col gap-1 text-red-700 dark:text-red-400">
                {deckProblems.map((problem) => (
                  <li key={problem.text}>• {problem.text}</li>
                ))}
                {problemsByName.size > 0 && (
                  <li>
                    • {problemsByName.size} {problemsByName.size === 1 ? "card has" : "cards have"}{" "}
                    a problem (marked ⚠ below).
                  </li>
                )}
              </ul>
            )}
          </section>
          <StatsPanel lines={deck.lines} format={format} />
          <DeckList
            lines={deck.lines}
            cards={deck.cards}
            problemsByName={problemsByName}
            onChange={changeLine}
            onSelect={(line) => {
              selectFromDeck(line);
              setTab("collection");
            }}
            busy={isSaving}
          />
        </aside>
      </div>
    </div>
  );
}

const COLOR_NAMES: Readonly<Record<Color, string>> = {
  W: "white",
  U: "blue",
  B: "black",
  R: "red",
  G: "green",
};

function GridCard(props: {
  card: BrowseCard;
  heading: string | null;
  inThisDeck: number;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const { card } = props;
  return (
    <>
      {props.heading !== null && (
        <li className="col-span-full pt-2 text-xs font-medium tracking-wide text-zinc-500 uppercase">
          {props.heading}
        </li>
      )}
      <li className="relative">
        <button
          type="button"
          data-card
          onClick={props.onSelect}
          aria-pressed={props.isSelected}
          aria-label={`${card.name}, you own ${card.owned}${props.inThisDeck > 0 ? `, ${props.inThisDeck} in this deck` : ""}`}
          className={`block w-full rounded-[5%] transition ${props.isSelected ? "ring-4 ring-sky-500" : "hover:scale-[1.03]"} ${card.misfit ? "opacity-45" : ""}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/images/${card.printingId}/normal/front`}
            alt=""
            loading="lazy"
            width={488}
            height={680}
            className="aspect-[488/680] w-full rounded-[4.5%] bg-zinc-200 dark:bg-zinc-800"
          />
        </button>
        <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-black/75 px-1.5 text-[11px] font-medium text-white">
          own {card.owned}
        </span>
        {props.inThisDeck > 0 && (
          <span className="pointer-events-none absolute top-1 right-1 rounded bg-green-700 px-1.5 text-[11px] font-semibold text-white">
            {props.inThisDeck} in deck
          </span>
        )}
        {card.misfit && (
          <span className="pointer-events-none absolute top-1 left-1 rounded bg-amber-600 px-1.5 text-[11px] font-medium text-white">
            {card.misfit === "color" ? "off-color" : "not legal"}
          </span>
        )}
        {card.otherDecks > 0 && (
          <span className="pointer-events-none absolute right-1 bottom-1 rounded bg-black/75 px-1.5 text-[11px] text-white">
            {card.otherDecks} other {card.otherDecks === 1 ? "deck" : "decks"}
          </span>
        )}
      </li>
    </>
  );
}

/**
 * The card an arrow key moves to: the next or previous one for left and right, and the nearest
 * one in the row above or below for up and down (rows are found by position on screen).
 */
function nextByPosition(buttons: HTMLElement[], index: number, key: string): number | null {
  if (key === "ArrowRight") return index + 1 < buttons.length ? index + 1 : null;
  if (key === "ArrowLeft") return index > 0 ? index - 1 : null;
  if (key !== "ArrowDown" && key !== "ArrowUp") return null;
  const here = buttons[index].getBoundingClientRect();
  const down = key === "ArrowDown";
  let best: { index: number; rowDistance: number; sideDistance: number } | null = null;
  for (const [candidate, button] of buttons.entries()) {
    const box = button.getBoundingClientRect();
    const rowDistance = down ? box.top - here.top : here.top - box.top;
    if (rowDistance <= 4) continue; // same row, or the wrong direction
    const sideDistance = Math.abs(box.left - here.left);
    const closerRow = best === null || rowDistance < best.rowDistance - 4;
    const sameRowButNearer =
      best !== null &&
      Math.abs(rowDistance - best.rowDistance) <= 4 &&
      sideDistance < best.sideDistance;
    if (closerRow || sameRowButNearer) best = { index: candidate, rowDistance, sideDistance };
  }
  return best === null ? null : best.index;
}
