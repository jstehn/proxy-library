"use client";
import type { RefObject } from "react";
import type { BrowseSort } from "@/modules/decks";
import { hasTerm, toggleTerm } from "@/shared/card-search";
import { COLORS, type ManaColor } from "@/shared/kernel";
import { ManaText } from "@/ui/mana";
import { CARD_SIZE_NAMES, type Browsing } from "./use-browse";

// Above the grid: where to search, the search box, card size, colors, quick filters and the sort.

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

const COLOR_NAMES: Readonly<Record<ManaColor, string>> = {
  W: "white",
  U: "blue",
  B: "black",
  R: "red",
  G: "green",
};

const pill = (pressed: boolean) =>
  `rounded-full px-2.5 py-0.5 text-xs ${pressed ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-zinc-300 dark:border-zinc-700"}`;

export function CollectionFilters(props: {
  browsing: Browsing;
  /** The search box, so "/" can jump to it from anywhere on the page. */
  searchRef: RefObject<HTMLInputElement | null>;
  showCommanderColors: boolean;
}) {
  const { browsing, searchRef } = props;
  const { source, search, setSearch, cardSize, showEverything } = browsing;
  const colorRing = (on: boolean) =>
    `rounded-full p-0.5 ${on ? "ring-2 ring-zinc-900 dark:ring-zinc-100" : "opacity-35"}`;

  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-label="Search in" className="flex items-center gap-1">
        <span className="text-muted mr-1 text-xs">Search</span>
        {(["mine", "all"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={source === option}
            onClick={() => browsing.setSource(option)}
            className={pill(source === option)}
          >
            {option === "mine" ? "My cards" : "All cards"}
          </button>
        ))}
        {source === "all" && (
          <span className="text-muted ml-1 text-xs">
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
          <span className="text-muted mr-1 hidden text-xs sm:inline">Card size</span>
          {CARD_SIZE_NAMES.map((size) => (
            <button
              key={size}
              type="button"
              aria-pressed={cardSize === size}
              aria-label={`${size[0].toUpperCase()}${size.slice(1)} cards`}
              onClick={() => browsing.setCardSize(size)}
              className={pill(cardSize === size)}
            >
              {size === "small" ? "S" : size === "medium" ? "M" : "L"}
            </button>
          ))}
        </div>
      </div>
      {browsing.notes.length > 0 && (
        <ul className="text-xs text-amber-700 dark:text-amber-400">
          {browsing.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-1.5" aria-label="Colors shown" role="group">
        {COLORS.map((color) => {
          const on = !showEverything && browsing.colors.includes(color);
          return (
            <button
              key={color}
              type="button"
              aria-pressed={on}
              aria-label={`Show ${COLOR_NAMES[color]} cards`}
              onClick={() => browsing.toggleColor(color)}
              className={colorRing(on)}
            >
              <ManaText text={`{${color}}`} />
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={!showEverything && browsing.includeColorless}
          aria-label="Show colorless cards"
          onClick={browsing.toggleColorless}
          className={colorRing(!showEverything && browsing.includeColorless)}
        >
          <ManaText text="{C}" />
        </button>
        {props.showCommanderColors && (
          <button
            type="button"
            className="text-xs underline"
            onClick={browsing.resetToCommanderColors}
          >
            Commander&apos;s colors
          </button>
        )}
        <label className="ml-auto flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={showEverything}
            onChange={(event) => browsing.setShowEverything(event.target.checked)}
          />
          Show cards that don&apos;t fit
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Quick filters">
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
        <span className="text-muted mx-1 text-xs">Mana value</span>
        {MANA_VALUE_FILTERS.map((term) => (
          <button
            key={term}
            type="button"
            aria-pressed={hasTerm(search, term)}
            aria-label={`Mana value ${term.slice(2)}`}
            onClick={() => setSearch((current) => toggleTerm(current, term, MANA_VALUE_FAMILY))}
            className={pill(hasTerm(search, term))}
          >
            {term === "mv>=7" ? "7+" : term.slice(3)}
          </button>
        ))}
      </div>
      <div className="text-muted flex items-center justify-between gap-2 text-xs">
        <span aria-live="polite">
          {browsing.isFirstPageLoading
            ? "Loading…"
            : `${browsing.total} ${browsing.total === 1 ? "card" : "cards"}`}
        </span>
        <label className="flex items-center gap-1">
          Sort
          <select
            value={browsing.sort}
            onChange={(event) => browsing.setSort(event.target.value as BrowseSort)}
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
  );
}
