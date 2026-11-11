"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { PrintingCard } from "@/modules/catalog";
import type {
  Board,
  Bracket,
  BracketRule,
  BrowseCard,
  BrowseSort,
  BrowseSource,
  DeckLine,
  Format,
  OtherDeckUse,
  SuggestionCard,
  SuggestionList,
} from "@/modules/decks";
import {
  bracketLine,
  bracketWarning,
  estimateBracket,
  headingMoved,
  isCounted,
  mainType,
} from "@/modules/decks/client";
import { bracketFlags, cardTags, hasTerm, toggleTerm, type Tag } from "@/shared/card-search";
import { Cents } from "@/shared/kernel";
import { ManaText } from "@/ui/mana";
import {
  addLandsAction,
  browseAction,
  cardDetailAction,
  headingAction,
  loadBuilderDeck,
  moveLineAction,
  otherDecksAction,
  setQuantityAction,
  setTargetBracketAction,
  similarAction,
  takeFromDeckAction,
  type BuilderDeck,
} from "./actions";
import { BracketPanel } from "./bracket-panel";
import { bracketWarningText } from "../../labels";
import { DeckList } from "./deck-list";
import { HeadingField } from "./heading-field";
import { commanderColorsOf, ownedWords, problemsOf, provisionalLine } from "./derive";
import { SuggestionsPanel } from "./suggestions";
import { CutsPanel } from "./cuts-panel";
import { DraftPanel } from "./draft-panel";
import { ManaBasePanel, type LandsToAdd } from "./mana-base-panel";
import { TestHandPanel } from "./test-hand";
import { PrintingPicker } from "./printing-picker";
import { countedCopies, SelectedCard, type Selection } from "./selected-card";
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

/**
 * How big the cards in the grid are. Phones get a fixed number of columns instead, since a
 * minimum width that suits a desktop leaves one lonely column on a phone. (Written out in full so
 * Tailwind finds the classes.)
 */
const CARD_SIZE_NAMES = ["small", "medium", "large"] as const;
type CardSize = (typeof CARD_SIZE_NAMES)[number];
const CARD_SIZES: Readonly<Record<CardSize, string>> = {
  small: "grid-cols-3 sm:grid-cols-[repeat(auto-fill,minmax(8rem,1fr))]",
  medium: "grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))]",
  large: "grid-cols-1 sm:grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]",
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

export function DeckBuilder(props: {
  deckId: number;
  format: Format;
  initialDeck: BuilderDeck;
  /** The Commander bracket the owner is aiming for (design doc 31). */
  targetBracket: Bracket | null;
  /** Seeds the test hands' shuffles (made by the server: ADR 0008's implementation note). */
  seed: string;
}) {
  const { deckId, format } = props;
  const isCommanderDeck = format === "commander";
  const [deck, setDeck] = useState(props.initialDeck);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [isSaving, startSaving] = useTransition();
  const latestChange = useRef(0);
  // Worked out from the deck in hand, so they change the moment a card goes in (design doc 19).
  const commanderColors = commanderColorsOf(format, deck.lines, deck.rules);
  const problems = problemsOf(format, deck.lines, deck.rules);
  // The bracket, live like the problems (design doc 31). Null outside Commander.
  const estimate = estimateBracket(format, deck.lines.map(bracketLine));
  const [targetBracket, setTargetBracket] = useState(props.targetBracket);
  const [isSavingTarget, startSavingTarget] = useTransition();
  const warning = bracketWarning(estimate, targetBracket);
  const [showTestHand, setShowTestHand] = useState(false);
  // The deck list marks one thing at a time: a role's cards or a bracket reason's.
  const [highlightedRole, setHighlightedRoleOnly] = useState<Tag | null>(null);
  const [highlightedRule, setHighlightedRule] = useState<BracketRule | null>(null);
  const setHighlightedRole = (tag: Tag | null) => {
    setHighlightedRoleOnly(tag);
    setHighlightedRule(null);
  };
  const highlightRule = (rule: BracketRule | null) => {
    setHighlightedRule(rule);
    setHighlightedRoleOnly(null);
  };
  const highlightedNames = new Set(
    estimate?.findings.find((finding) => finding.rule === highlightedRule)?.cards ?? [],
  );
  function changeTarget(target: Bracket | null) {
    const before = targetBracket;
    setTargetBracket(target);
    startSavingTarget(async () => {
      const result = await setTargetBracketAction({ deckId, target });
      if (!result.ok) {
        setTargetBracket(before);
        setMessage({ tone: "error", text: result.message });
      }
    });
  }
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showCuts, setShowCuts] = useState(false);
  const [showDraft, setShowDraft] = useState(false);
  const [showManaBase, setShowManaBase] = useState(false);
  /** Cards like the selected one, once asked for (null: not asked; "loading": on its way). */
  const [similar, setSimilar] = useState<{
    oracleId: string;
    list: SuggestionList | "loading" | null;
  } | null>(null);
  // Changes whenever the deck's contents do, so suggestions can follow the deck.
  const deckKey = deck.lines
    .map((line) => `${line.board}:${line.oracleId}:${line.quantity}`)
    .sort()
    .join(",");

  // What to browse. A Commander deck starts with its commander's colors (design doc 14,
  // decision 2); every other deck starts with every color, and anyone can pick colors.
  const startingColors = (colors: Color[] | null): Color[] =>
    isCommanderDeck && colors !== null ? colors : [...COLORS];
  // The grid always starts on the cards you own; "All cards" searches the whole catalog
  // (design doc 29, decision 1).
  const [source, setSource] = useState<BrowseSource>("mine");
  const [search, setSearch] = useState("");
  const [waitedSearch, setWaitedSearch] = useState("");
  const [colors, setColors] = useState<Color[]>(() => startingColors(commanderColors));
  const [includeColorless, setIncludeColorless] = useState(true);
  const [showEverything, setShowEverything] = useState(false);
  const [sort, setSort] = useState<BrowseSort>("name");
  const [cardSize, setCardSize] = useState<CardSize>("medium");
  const [browse, setBrowse] = useState<BrowseState>(EMPTY_BROWSE);
  const latestBrowse = useRef(0);

  // When the commander changes, its colors become the filter (adjusting state while rendering,
  // React's pattern for "reset when a prop changes", rather than in an effect).
  const commanderKey = (commanderColors ?? []).join("");
  const [seenCommanderKey, setSeenCommanderKey] = useState(commanderKey);
  if (commanderKey !== seenCommanderKey) {
    setSeenCommanderKey(commanderKey);
    setColors(startingColors(commanderColors));
  }

  const [selected, setSelected] = useState<Selection | null>(null);
  /** The grid card behind the selection, to show a new card before the server answers. */
  const selectedCard = useRef<BrowseCard | null>(null);
  const selectedPrinting = useRef<string | null>(null);
  const selectedOracle = useRef<string | null>(null);
  const [detail, setDetail] = useState<PrintingCard | null>(null);
  /** The selected card's other decks (task 42): "loading" while they're fetched. */
  const [otherDecks, setOtherDecks] = useState<readonly OtherDeckUse[] | "loading">([]);
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

  // "/" jumps to the search box from anywhere on the page, as on Scryfall and GitHub; "H" opens
  // or closes the test hand.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = target?.closest("input, textarea, select") !== null;
      if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (event.key.toLowerCase() === "h") {
        event.preventDefault();
        setShowTestHand((value) => !value);
      } else if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        setShowSuggestions((value) => !value);
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
  /** Copies in the deck, the maybeboard left out (design doc 32). */
  const totalInDeck = (oracleId: string) => countedCopies(inDeck(oracleId));

  /** Selects a card. `uses` are its other decks when already known (a deck line has them). */
  function select(selection: Selection, uses?: readonly OtherDeckUse[]) {
    selectedPrinting.current = selection.printingId;
    selectedOracle.current = selection.oracleId;
    setSelected(selection);
    setQuantity(1);
    if (uses !== undefined || selection.otherDecks === 0) {
      setOtherDecks(uses ?? []);
    } else {
      loadOtherDecks(selection.oracleId);
    }
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
    selectedCard.current = card;
    select({
      oracleId: card.oracleId,
      printingId: card.printingId,
      name: card.name,
      owned: card.owned,
      ownedReal: card.ownedReal,
      inDeck: inDeck(card.oracleId),
      otherDecks: card.otherDecks,
      free: card.free,
      misfit: card.misfit,
      priceCents: card.priceCents,
      tags: cardTags({ typeLine: card.typeLine, text: card.text, producedMana: card.producedMana }),
      bracketFlags: bracketFlags(card),
    });
  }

  /** A suggestion is selected like a grid card; on a phone, the selected card is on the left tab. */
  function selectSuggestion(card: SuggestionCard) {
    selectFromGrid(card);
    setTab("collection");
  }

  function showSimilar(oracleId: string) {
    setSimilar({ oracleId, list: "loading" });
    void similarAction({ deckId, oracleId }).then((list) => {
      setSimilar((current) => (current?.oracleId === oracleId ? { oracleId, list } : current));
    });
  }

  function selectFromDeck(line: DeckLine) {
    selectedCard.current = null;
    select(
      {
        oracleId: line.oracleId,
        printingId: line.printingId,
        name: line.name,
        owned: line.owned,
        ownedReal: line.ownedReal,
        inDeck: inDeck(line.oracleId),
        otherDecks: line.otherDecks.length,
        free: line.free,
        misfit: null,
        priceCents: line.priceCents,
        tags: cardTags({
          typeLine: line.typeLine,
          text: line.text,
          producedMana: line.producedMana,
        }),
        bracketFlags: bracketFlags(line),
      },
      line.otherDecks,
    );
  }

  function loadOtherDecks(oracleId: string) {
    setOtherDecks("loading");
    void otherDecksAction({ deckId, oracleId }).then((uses) => {
      if (selectedOracle.current === oracleId) setOtherDecks(uses);
    });
  }

  /** Takes copies out of another deck so they're free here (task 42); this deck stays as it is. */
  function takeFrom(use: OtherDeckUse, count: number) {
    if (selected === null) return;
    const card = selected;
    startSaving(async () => {
      const result = await takeFromDeckAction({
        deckId,
        fromDeckId: use.deckId,
        oracleId: card.oracleId,
        count,
      });
      if (!result.ok) {
        setMessage({ tone: "error", text: result.message });
        return;
      }
      setDeck(result.deck);
      const free = Math.min(card.free + count, card.owned);
      const left = use.quantity - count;
      setSelected((current) =>
        current?.oracleId === card.oracleId
          ? { ...current, free, otherDecks: current.otherDecks - (left === 0 ? 1 : 0) }
          : current,
      );
      loadOtherDecks(card.oracleId);
      setMessage({
        tone: "ok",
        text: `Took ${count} ${card.name} out of ${use.name}${left === 0 ? "" : ` (it has ${left} left)`}.`,
      });
    });
  }

  /** Saves a new quantity for one card on one board; the deck updates at once where it can. */
  function saveQuantity(
    change: { oracleId: string; printingId?: string; board: Board; quantity: number },
    done: string,
  ) {
    const request = ++latestChange.current;
    // Show the change straight away. A card new to the deck gets a provisional line made from its
    // grid card, so its problems and statistics show before the server answers (design doc 19).
    const card = selectedCard.current?.oracleId === change.oracleId ? selectedCard.current : null;
    setDeck((current) => {
      const exists = current.lines.some(
        (line) => line.oracleId === change.oracleId && line.board === change.board,
      );
      if (!exists && card !== null && change.quantity > 0) {
        return {
          ...current,
          lines: [...current.lines, provisionalLine(card, change.board, change.quantity)],
          rules: { [card.oracleId]: card.rules, ...current.rules },
        };
      }
      return {
        ...current,
        lines: current.lines
          .map((line) =>
            line.oracleId === change.oracleId && line.board === change.board
              ? { ...line, quantity: change.quantity }
              : line,
          )
          .filter((line) => line.quantity > 0),
      };
    });
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
        : `Added ${added} ${selected.name} (now ${next}${board === "side" ? " in the sideboard" : board === "maybe" ? " on the maybeboard" : ""}${added < quantity ? ", the most one line can hold" : ""}).`,
    );
    setSelected({ ...selected, inDeck: { ...selected.inDeck, [board]: next } });
  }

  /** Moves a line to another board (design doc 32); the deck shows the move at once. */
  function moveLine(line: DeckLine, to: Board) {
    const request = ++latestChange.current;
    setDeck((current) => {
      const there = current.lines.find(
        (other) => other.oracleId === line.oracleId && other.board === to,
      );
      const rest = current.lines.filter(
        (other) =>
          other.oracleId !== line.oracleId || (other.board !== line.board && other.board !== to),
      );
      const quantity = Math.min(99, line.quantity + (there?.quantity ?? 0));
      return { ...current, lines: [...rest, { ...line, board: to, quantity }] };
    });
    startSaving(async () => {
      const result = await moveLineAction({
        deckId,
        oracleId: line.oracleId,
        from: line.board,
        to,
      });
      if (request !== latestChange.current) return;
      if (result.ok) {
        setDeck(result.deck);
        setMessage({
          tone: "ok",
          text:
            to === "maybe"
              ? `Moved ${line.name} to the maybeboard.`
              : `Moved ${line.name} into the deck.`,
        });
      } else {
        setMessage({ tone: "error", text: result.message });
      }
    });
  }

  /** Adds the mana base panel's lands (design doc 35) and shows the deck the server now has. */
  function addLands(lands: LandsToAdd, count: number, customText?: string) {
    const request = ++latestChange.current;
    startSaving(async () => {
      const result = await addLandsAction({ deckId, lands: [...lands] });
      if (request !== latestChange.current) return;
      if (result.ok) {
        setDeck(result.deck);
        setMessage({
          tone: "ok",
          text: customText ?? `Added ${count} ${count === 1 ? "land" : "lands"}.`,
        });
      } else {
        setMessage({ tone: "error", text: result.message });
      }
    });
  }

  /**
   * Saves a heading change (design doc 34) and shows the deck as the server now has it. `local`
   * changes the deck in hand at once, so the list regroups before the answer comes.
   */
  function saveHeadings(
    change: Parameters<typeof headingAction>[0],
    text: string,
    local: (current: BuilderDeck) => BuilderDeck,
  ) {
    const request = ++latestChange.current;
    setDeck(local);
    startSaving(async () => {
      const result = await headingAction(change);
      if (request !== latestChange.current) return;
      if (result.ok) {
        setDeck(result.deck);
        setMessage({ tone: "ok", text });
      } else {
        setMessage({ tone: "error", text: result.message });
        // Undo the change in hand: the deck as the server has it.
        const fresh = await loadBuilderDeck(deckId);
        if (fresh !== null) setDeck(fresh);
      }
    });
  }

  function setLineHeading(line: DeckLine, heading: string | null) {
    saveHeadings(
      { kind: "set", deckId, oracleId: line.oracleId, board: line.board, heading },
      heading === null ? `${line.name}: no heading.` : `${line.name}: under ${heading}.`,
      (current) => ({
        ...current,
        lines: current.lines.map((each) => (each === line ? { ...each, heading } : each)),
      }),
    );
  }

  function moveHeading(heading: string, direction: "up" | "down") {
    const order = headingMoved(deck.headings, heading, direction);
    saveHeadings({ kind: "order", deckId, order }, `Moved ${heading} ${direction}.`, (current) => ({
      ...current,
      headings: order,
    }));
  }

  function renameHeading(from: string, to: string | null) {
    saveHeadings(
      { kind: "rename", deckId, from, to },
      to === null ? `Cleared ${from}.` : `Renamed ${from} to ${to.trim()}.`,
      (current) => current,
    );
  }

  function setGrouping(grouping: BuilderDeck["grouping"]) {
    saveHeadings(
      { kind: "grouping", deckId, grouping },
      grouping === "custom" ? "Grouped by your headings." : "Grouped by card type.",
      (current) => ({ ...current, grouping }),
    );
  }

  function changeLine(line: DeckLine, next: number) {
    saveQuantity(
      { oracleId: line.oracleId, board: line.board, quantity: Math.max(0, Math.min(99, next)) },
      next <= 0 ? `Removed ${line.name}.` : `${line.name}: now ${next}.`,
    );
  }

  /** A printing was chosen (design doc 24): show the fresh deck and the new picture. */
  function printingChosen(fresh: BuilderDeck, text: string) {
    setDeck(fresh);
    setMessage({ tone: "ok", text });
    if (selected === null) return;
    const line = fresh.lines.find((each) => each.oracleId === selected.oracleId);
    if (line !== undefined && line.printingId !== selected.printingId) {
      selectedCard.current = null;
      select({ ...selected, printingId: line.printingId });
    }
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
  for (const problem of problems) {
    if (problem.name !== null) {
      problemsByName.set(problem.name, [...(problemsByName.get(problem.name) ?? []), problem.text]);
    }
  }
  const deckProblems = problems.filter((problem) => problem.name === null);
  // The maybeboard isn't counted (design doc 32).
  const cardTotal = deck.lines
    .filter((line) => isCounted(line.board))
    .reduce((sum, line) => sum + line.quantity, 0);
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
            <div role="group" aria-label="Search in" className="flex items-center gap-1">
              <span className="mr-1 text-xs text-zinc-500">Search</span>
              {(["mine", "all"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={source === option}
                  onClick={() => setSource(option)}
                  className={pill(source === option)}
                >
                  {option === "mine" ? "My cards" : "All cards"}
                </button>
              ))}
              {source === "all" && (
                <span className="ml-1 text-xs text-zinc-500">
                  Cards you don&apos;t own show as short; buy them when you&apos;re done.
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                ref={searchRef}
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label={source === "mine" ? "Search your cards" : "Search every card"}
                placeholder='Search: bolt, t:creature mv<=3, o:"draw a card", id<=esper'
                className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
              />
              <div role="group" aria-label="Card size" className="flex shrink-0 items-center gap-1">
                <span className="mr-1 hidden text-xs text-zinc-500 sm:inline">Card size</span>
                {CARD_SIZE_NAMES.map((size) => (
                  <button
                    key={size}
                    type="button"
                    aria-pressed={cardSize === size}
                    aria-label={`${size[0].toUpperCase()}${size.slice(1)} cards`}
                    onClick={() => setCardSize(size)}
                    className={pill(cardSize === size)}
                  >
                    {size === "small" ? "S" : size === "medium" ? "M" : "L"}
                  </button>
                ))}
              </div>
            </div>
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
              {isCommanderDeck && commanderColors !== null && (
                <button
                  type="button"
                  className="text-xs underline"
                  onClick={() => {
                    setShowEverything(false);
                    setColors(startingColors(commanderColors));
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
                Show cards that don&apos;t fit
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
            aria-label={source === "mine" ? "Cards you own" : "Every card"}
            className={`grid ${CARD_SIZES[cardSize]} gap-3 transition-opacity ${isFirstPageLoading && browse.cards.length > 0 ? "opacity-60" : ""}`}
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
              {source === "mine" ? "None of your cards match" : "No cards match"}. Try fewer
              filters, or &quot;Show cards that don&apos;t fit&quot;.
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
                deckId={deckId}
                isCommanderDeck={isCommanderDeck}
                onClose={() => setSelected(null)}
                similar={similar?.oracleId === selected.oracleId ? similar.list : null}
                onShowSimilar={() => showSimilar(selected.oracleId)}
                onSelectSimilar={selectSuggestion}
                otherDecks={otherDecks}
                onTake={takeFrom}
              />
              {deck.lines
                .filter((line) => line.oracleId === selected.oracleId && line.board === "main")
                .map((line) => (
                  <div
                    key={`heading-${line.oracleId}-${line.heading ?? ""}`}
                    className="border-t border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950"
                  >
                    <HeadingField
                      line={line}
                      headings={deck.headings}
                      busy={isSaving}
                      onSave={setLineHeading}
                    />
                  </div>
                ))}
              {deck.lines.some((line) => line.oracleId === selected.oracleId) && (
                <div className="border-t border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
                  <PrintingPicker
                    key={selected.oracleId}
                    deckId={deckId}
                    lines={deck.lines.filter((line) => line.oracleId === selected.oracleId)}
                    onChosen={printingChosen}
                    onError={(text) => setMessage({ tone: "error", text })}
                  />
                </div>
              )}
            </div>
          )}
        </section>

        <aside
          aria-label="The deck"
          className={`w-full flex-col gap-6 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:w-[26rem] lg:overflow-y-auto lg:pr-1 ${tab === "deck" ? "flex" : "hidden lg:flex"}`}
        >
          <section aria-label="Problems" className="flex flex-col gap-1 text-sm">
            {problems.length === 0 ? (
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
            {/* Over target is a warning, not a problem: the deck still follows the rules. */}
            {warning !== null && (
              <p className="text-amber-700 dark:text-amber-400">⚠ {bracketWarningText(warning)}</p>
            )}
          </section>
          {estimate !== null && (
            <BracketPanel
              estimate={estimate}
              target={targetBracket}
              onTargetChange={changeTarget}
              saving={isSavingTarget}
              highlighted={highlightedRule}
              onHighlight={highlightRule}
            />
          )}
          <StatsPanel
            lines={deck.lines}
            format={format}
            highlighted={highlightedRole}
            onHighlight={setHighlightedRole}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              aria-expanded={showSuggestions}
              onClick={() => setShowSuggestions((value) => !value)}
              className="rounded-md border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700"
            >
              {showSuggestions ? "Hide suggestions" : "Suggestions"}
            </button>
            <button
              type="button"
              aria-expanded={showCuts}
              onClick={() => setShowCuts((value) => !value)}
              className="rounded-md border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700"
            >
              {showCuts ? "Hide possible cuts" : "Possible cuts"}
            </button>
            <button
              type="button"
              aria-expanded={showManaBase}
              onClick={() => setShowManaBase((value) => !value)}
              className="rounded-md border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700"
            >
              {showManaBase ? "Hide mana base" : "Mana base"}
            </button>
            {isCommanderDeck && (
              <button
                type="button"
                aria-expanded={showDraft}
                onClick={() => setShowDraft((value) => !value)}
                className="rounded-md border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700"
              >
                {showDraft
                  ? "Hide draft"
                  : cardTotal > 0 && cardTotal < 100
                    ? `Draft deck (fill ${100 - cardTotal})`
                    : "Draft deck"}
              </button>
            )}
            <button
              type="button"
              aria-expanded={showTestHand}
              onClick={() => setShowTestHand((value) => !value)}
              className="rounded-md border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700"
            >
              {showTestHand ? "Hide test hand" : "Test hand"}
            </button>
          </div>
          {showDraft && (
            <DraftPanel
              deckId={deckId}
              deckKey={`${deckKey}|${targetBracket ?? ""}`}
              onAdd={(cards, count, label) => addLands(cards, count, label)}
              onClose={() => setShowDraft(false)}
              busy={isSaving}
            />
          )}
          {showSuggestions && (
            <SuggestionsPanel
              deckId={deckId}
              deckKey={`${deckKey}|${targetBracket ?? ""}`}
              onSelect={selectSuggestion}
              onClose={() => setShowSuggestions(false)}
            />
          )}
          {showCuts && (
            <CutsPanel
              lines={deck.lines}
              format={format}
              targetBracket={targetBracket}
              onMove={moveLine}
              onSelect={(line) => {
                selectFromDeck(line);
                setTab("collection");
              }}
              onClose={() => setShowCuts(false)}
              busy={isSaving}
            />
          )}
          {showManaBase && (
            <ManaBasePanel
              deckId={deckId}
              deckKey={deckKey}
              onAdd={addLands}
              onClose={() => setShowManaBase(false)}
              busy={isSaving}
            />
          )}
          {showTestHand && (
            <TestHandPanel
              lines={deck.lines}
              format={format}
              seed={props.seed}
              cards={deck.cards}
              onClose={() => setShowTestHand(false)}
            />
          )}
          <DeckList
            lines={deck.lines}
            cards={deck.cards}
            problemsByName={problemsByName}
            onChange={changeLine}
            onMove={moveLine}
            onSelect={(line) => {
              selectFromDeck(line);
              setTab("collection");
            }}
            busy={isSaving}
            highlighted={highlightedRole}
            highlightedNames={highlightedNames}
            grouping={deck.grouping}
            headings={deck.headings}
            onGrouping={setGrouping}
            onMoveHeading={moveHeading}
            onRenameHeading={renameHeading}
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
      <li>
        <button
          type="button"
          data-card
          onClick={props.onSelect}
          aria-pressed={props.isSelected}
          aria-label={`${card.name}, ${card.owned === 0 ? "not owned" : `you own ${card.owned}`}${props.inThisDeck > 0 ? `, ${props.inThisDeck} in this deck` : ""}`}
          className="group block w-full text-left"
        >
          <span
            className={`relative block rounded-[5%] transition ${props.isSelected ? "ring-4 ring-sky-500" : "group-hover:scale-[1.03]"} ${card.misfit ? "opacity-45" : ""}`}
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
            {props.inThisDeck > 0 && (
              <span className="absolute top-1 right-1 rounded bg-green-700 px-1.5 text-[11px] font-semibold text-white">
                {props.inThisDeck} in deck
              </span>
            )}
            {card.misfit && (
              <span className="absolute top-1 left-1 rounded bg-amber-600 px-1.5 text-[11px] font-medium text-white">
                {card.misfit === "color" ? "off-color" : "not legal"}
              </span>
            )}
          </span>
          {/* The name, always readable (the art's own text is small at this size). */}
          <span className="mt-1 flex items-baseline gap-1 text-sm leading-tight">
            <span className="min-w-0 flex-1 truncate font-medium" title={card.name}>
              {card.name}
            </span>
            {card.manaCost && (
              <span className="shrink-0 text-xs">
                <ManaText text={card.manaCost} />
              </span>
            )}
          </span>
          <span className="block text-xs text-zinc-500">
            {card.owned === 0 ? (
              <>
                <span className="font-medium text-amber-700 dark:text-amber-400">Not owned</span>
                {card.priceCents !== null && ` · ${Cents.format(Cents.of(card.priceCents))}`}
              </>
            ) : (
              `own ${ownedWords(card.owned, card.ownedReal)}`
            )}
            {card.otherDecks > 0 &&
              `${card.owned > 0 ? ` · ${card.free} free` : ""} · in ${card.otherDecks} other ${card.otherDecks === 1 ? "deck" : "decks"}`}
          </span>
        </button>
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
