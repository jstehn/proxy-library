import Link from "next/link";
import {
  COMMANDER_SORTS,
  commandersICanBuild,
  SPELL_SLOTS,
  type CommanderCoverage,
  type CommanderSort,
} from "@/modules/decks";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { canonicalTheme, THEME_LABELS, THEMES, type Theme } from "@/shared/card-search";
import { Cents } from "@/shared/kernel";
import { Alert } from "@/ui/form";
import { ManaStylesheet, ManaText } from "@/ui/mana";
import { planText, TAG_LABELS } from "../labels";
import { startDeckAction } from "./actions";
import { CommanderCards, CommanderThumbnail } from "./commander-cards";

// Decks → Find a commander (design docs 36 and 39): the cards that could lead a deck, with
// Oracle text, hover card preview, theme/tribe filtering, and coverage / popularity / power ordering.

const COLORS = ["W", "U", "B", "R", "G"] as const;
type Color = (typeof COLORS)[number];
const COLOR_NAMES: Record<Color, string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
};

const SORT_LABELS: Readonly<Record<CommanderSort, string>> = {
  coverage: "Cards I own (coverage)",
  combined: "Blend (coverage + popularity + power)",
  popularity: "Popularity (EDHREC rank)",
  power: "Power heuristic (Game Changer & card strength)",
};

/** How many rows each "Show more" adds. */
const PAGE = 25;

function chosenColors(value: string | string[] | undefined): Color[] {
  const text = Array.isArray(value) ? value.join("") : (value ?? "");
  return COLORS.filter((color) => text.includes(color));
}

function firstParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

function chosenSort(value: string | string[] | undefined): CommanderSort {
  const raw = firstParam(value);
  return (COMMANDER_SORTS as readonly string[]).includes(raw) ? (raw as CommanderSort) : "coverage";
}

function chosenTheme(value: string | string[] | undefined): Theme | undefined {
  const raw = firstParam(value);
  if (raw === "") return undefined;
  return canonicalTheme(raw) ?? undefined;
}

const fieldClass =
  "rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700";

export default async function FindCommanderPage(props: PageProps<"/decks/commanders">) {
  const actor = await requireActor();
  const searchParams = await props.searchParams;
  const colors = chosenColors(searchParams.colors);
  const theme = chosenTheme(searchParams.theme);
  const tribe = firstParam(searchParams.tribe);
  const sort = chosenSort(searchParams.sort);
  const includeStore = searchParams.store === "1";
  const withReal = searchParams.real === "1";
  const shown = Math.max(PAGE, Number(searchParams.show) || PAGE);
  const ranked = await commandersICanBuild(getContainer().db, actor.userId, {
    colors,
    theme,
    tribe: tribe || undefined,
    sort,
    includeStore,
    withReal,
  });
  const error = searchParams.error;

  const buildUrl = (overrides: {
    show?: number;
    theme?: Theme | "";
    tribe?: string;
    sort?: CommanderSort;
  }) => {
    const params = new URLSearchParams();
    if (colors.length > 0) params.set("colors", colors.join(""));
    const nextTheme = overrides.theme !== undefined ? overrides.theme : (theme ?? "");
    if (nextTheme !== "") params.set("theme", nextTheme);
    const nextTribe = overrides.tribe !== undefined ? overrides.tribe : tribe;
    if (nextTribe !== "") params.set("tribe", nextTribe);
    const nextSort = overrides.sort ?? sort;
    if (nextSort !== "coverage") params.set("sort", nextSort);
    if (includeStore) params.set("store", "1");
    if (withReal) params.set("real", "1");
    if (overrides.show !== undefined && overrides.show > PAGE) {
      params.set("show", String(overrides.show));
    }
    const queryString = params.toString();
    return queryString === "" ? "/decks/commanders" : `/decks/commanders?${queryString}`;
  };

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-12">
      <ManaStylesheet />
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Find a commander</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Cards that could lead a Commander deck: filter by colors, theme (such as Politics, Voting,
          Treasures, or Blink) or creature tribe, and order by how much of a {SPELL_SLOTS}
          -spell deck your cards already cover, Scryfall EDHREC popularity, or a rough card-power
          heuristic. Every copy you own counts, even ones in other decks. Hover or tap a card
          thumbnail to enlarge it. All rankings are starting-point heuristics over rules text and
          catalog metadata, not tournament win rates or a verdict on a finished deck.{" "}
          <Link href="/decks" className="underline">
            Your decks
          </Link>
        </p>
      </header>
      {typeof error === "string" && <Alert tone="error">{error}</Alert>}

      <form className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm" method="get">
        <fieldset className="flex items-center gap-2">
          <legend className="sr-only">Colors the commander includes</legend>
          {COLORS.map((color) => (
            <label key={color} className="flex items-center gap-1" title={COLOR_NAMES[color]}>
              <input
                type="checkbox"
                name="colors"
                value={color}
                defaultChecked={colors.includes(color)}
              />
              <ManaText text={`{${color}}`} />
              <span className="sr-only">{COLOR_NAMES[color]}</span>
            </label>
          ))}
        </fieldset>
        <label className="flex items-center gap-1.5">
          <span className="text-xs text-zinc-500">Theme</span>
          <select name="theme" defaultValue={theme ?? ""} className={fieldClass}>
            <option value="">Any theme</option>
            {THEMES.map((entry) => (
              <option key={entry} value={entry}>
                {THEME_LABELS[entry]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-xs text-zinc-500">Tribe</span>
          <input
            type="text"
            name="tribe"
            defaultValue={tribe}
            placeholder="e.g. Elf, Dragon"
            className={`${fieldClass} w-32`}
          />
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-xs text-zinc-500">Order by</span>
          <select name="sort" defaultValue={sort} className={fieldClass}>
            {COMMANDER_SORTS.map((mode) => (
              <option key={mode} value={mode}>
                {SORT_LABELS[mode]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" name="store" value="1" defaultChecked={includeStore} />
          Also legends I don&apos;t own
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" name="real" value="1" defaultChecked={withReal} />
          Count my real cards
        </label>
        <button
          type="submit"
          className="rounded-md bg-zinc-900 px-3 py-1 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Show
        </button>
        {(colors.length > 0 || theme !== undefined || tribe !== "" || sort !== "coverage") && (
          <Link href="/decks/commanders" className="text-xs text-zinc-500 underline">
            Reset filters
          </Link>
        )}
      </form>

      {ranked.length === 0 ? (
        <p className="text-sm text-zinc-500">
          {includeStore
            ? "No card that could lead a deck matches these filters."
            : "You don't own a card that could lead a deck matching these filters. Try “Also legends I don't own”."}
        </p>
      ) : (
        <>
          <p className="text-sm text-zinc-500">
            {ranked.length} {ranked.length === 1 ? "commander" : "commanders"}
            {theme !== undefined && ` leading ${THEME_LABELS[theme]}`}
            {tribe !== "" && ` matching tribe “${tribe}”`}
            {colors.length > 0 && " with these colors"} · ordered by{" "}
            {SORT_LABELS[sort].toLowerCase()}.
          </p>
          <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
            {ranked.slice(0, shown).map((coverage) => (
              <CommanderRow
                key={coverage.commander.oracleId}
                coverage={coverage}
                withReal={withReal}
                activeTheme={theme}
                activeTribe={tribe}
                buildUrl={buildUrl}
              />
            ))}
          </ul>
          {ranked.length > shown && (
            <Link
              href={buildUrl({ show: shown + PAGE })}
              className="self-start text-sm underline"
              scroll={false}
            >
              Show more ({ranked.length - shown} left)
            </Link>
          )}
        </>
      )}
    </main>
  );
}

function CommanderRow(props: {
  coverage: CommanderCoverage;
  withReal: boolean;
  activeTheme: Theme | undefined;
  activeTribe: string;
  buildUrl: (overrides: { theme?: Theme | ""; tribe?: string }) => string;
}) {
  const { coverage } = props;
  const { commander } = coverage;
  const plan = planText(coverage.plan);
  const identity =
    commander.colorIdentity.length === 0
      ? "{C}"
      : commander.colorIdentity.map((color) => `{${color}}`).join("");
  const paragraphs = commander.text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

  return (
    <li className="flex gap-3 py-4">
      <CommanderThumbnail printingId={commander.printingId} name={commander.name} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium">{commander.name}</span>
          {commander.manaCost ? (
            <ManaText text={commander.manaCost} />
          ) : (
            <ManaText text={identity} />
          )}
          <span className="text-xs text-zinc-500" title="Color identity">
            ({<ManaText text={identity} />})
          </span>
          {commander.isGameChanger && (
            <span className="rounded bg-amber-100 px-1.5 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              Game Changer
            </span>
          )}
          {commander.edhrecRank !== null && commander.edhrecRank !== undefined && (
            <span
              className="rounded bg-zinc-100 px-1.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
              title="Scryfall EDHREC popularity rank (lower is in more decks)"
            >
              EDHREC #{commander.edhrecRank.toLocaleString("en-US")}
            </span>
          )}
          {commander.ownedCopies === 0 && (
            <span className="rounded bg-zinc-100 px-1.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
              not owned
              {commander.priceCents !== null &&
                ` · ${Cents.format(Cents.of(commander.priceCents))}`}
            </span>
          )}
        </div>
        <p className="text-xs text-zinc-600 italic dark:text-zinc-400">{commander.typeLine}</p>
        {paragraphs.length > 0 && (
          <div className="flex flex-col gap-1 rounded-md bg-zinc-50 px-2.5 py-1.5 text-xs leading-relaxed text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
            {paragraphs.map((paragraph, index) => (
              <p key={index}>
                <ManaText text={paragraph} />
              </p>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
          {plan === "" ? (
            <span>No plan read from its text.</span>
          ) : (
            <>
              <span>Leads:</span>
              {coverage.plan.themes.map((themeItem) => (
                <Link
                  key={themeItem}
                  href={props.buildUrl({
                    theme: props.activeTheme === themeItem ? "" : themeItem,
                  })}
                  className={`rounded px-1.5 py-0.5 ${
                    props.activeTheme === themeItem
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"
                  }`}
                >
                  {THEME_LABELS[themeItem]}
                </Link>
              ))}
              {coverage.plan.tribes.map((tribeItem) => (
                <Link
                  key={tribeItem}
                  href={props.buildUrl({
                    tribe:
                      props.activeTribe.toLowerCase() === tribeItem.toLowerCase() ? "" : tribeItem,
                  })}
                  className={`rounded px-1.5 py-0.5 ${
                    props.activeTribe.toLowerCase() === tribeItem.toLowerCase()
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"
                  }`}
                >
                  {tribeItem} kindred
                </Link>
              ))}
              {coverage.plan.keywords.map((keyword) => (
                <span key={keyword} className="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">
                  {keyword}
                </span>
              ))}
            </>
          )}
        </div>
        <p>
          <span className="font-medium">{coverage.onPlan}</span> on-plan ·{" "}
          <span className="font-medium">
            {coverage.filled} of {SPELL_SLOTS}
          </span>{" "}
          spells from your cards · {coverage.ownedLands}{" "}
          {coverage.ownedLands === 1 ? "land" : "lands"}
          <span className="text-xs text-zinc-500">
            {" "}
            · coverage {coverage.score} · power {coverage.powerScore}
          </span>
        </p>
        <ul className="flex flex-wrap gap-x-3 text-xs" aria-label="Roles">
          {coverage.roles.map((role) => (
            <li
              key={role.tag}
              className={
                role.have >= role.target
                  ? "text-zinc-600 dark:text-zinc-400"
                  : "text-amber-700 dark:text-amber-400"
              }
            >
              {TAG_LABELS[role.tag]} {role.have} of {role.target}
            </li>
          ))}
        </ul>
        {commander.leads.length > 0 && (
          <p className="text-xs text-zinc-500">Already leads {commander.leads.join(", ")}.</p>
        )}
        <div className="flex flex-wrap items-start gap-2 pt-1">
          <form action={startDeckAction}>
            <input type="hidden" name="name" value={commander.name} />
            {props.withReal && <input type="hidden" name="real" value="1" />}
            <button
              type="submit"
              className="rounded-md bg-zinc-900 px-3 py-1 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900"
            >
              Start a deck
            </button>
          </form>
          <CommanderCards oracleId={commander.oracleId} withReal={props.withReal} />
        </div>
      </div>
    </li>
  );
}
