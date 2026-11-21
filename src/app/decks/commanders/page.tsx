import Link from "next/link";
import {
  COMMANDER_SORTS,
  SPELL_SLOTS,
  type CommanderCoverage,
  type CommanderSort,
} from "@/modules/decks";
import { readPage } from "@/server/page-instance";
import { canonicalTheme } from "@/shared/card-search";
import { Cents, COLORS, type ManaColor, type Theme, THEME_LABELS, THEMES } from "@/shared/kernel";
import { Alert } from "@/ui/form";
import { ManaStylesheet, ManaText } from "@/ui/mana";
import { planText, TAG_LABELS } from "../labels";
import { startDeckAction } from "./actions";
import { CommanderCards, CommanderThumbnail } from "./commander-cards";
import { Button } from "@/ui/button";
import { Input, Select } from "@/ui/field";
import { Page } from "@/ui/page";

// Decks → Find a commander (design docs 36 and 39): the cards that could lead a deck, with
// Oracle text, hover card preview, theme/tribe filtering, and coverage / popularity / power ordering.

const COLOR_NAMES: Record<ManaColor, string> = {
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

function chosenColors(value: string | string[] | undefined): ManaColor[] {
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

export default async function FindCommanderPage(props: PageProps<"/decks/commanders">) {
  const { actor, reads } = await readPage();
  const searchParams = await props.searchParams;
  const colors = chosenColors(searchParams.colors);
  const theme = chosenTheme(searchParams.theme);
  const tribe = firstParam(searchParams.tribe);
  const sort = chosenSort(searchParams.sort);
  const includeStore = searchParams.store === "1";
  const withReal = searchParams.real === "1";
  const shown = Math.max(PAGE, Number(searchParams.show) || PAGE);
  const ranked = await reads.decks.commandersICanBuild(actor, {
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
    <Page>
      <ManaStylesheet />
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Find a commander</h1>
        <p className="text-muted text-sm">
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
          <span className="text-muted text-xs">Theme</span>
          <Select name="theme" defaultValue={theme ?? ""} controlSize="sm">
            <option value="">Any theme</option>
            {THEMES.map((entry) => (
              <option key={entry} value={entry}>
                {THEME_LABELS[entry]}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-muted text-xs">Tribe</span>
          <Input
            type="text"
            name="tribe"
            defaultValue={tribe}
            placeholder="e.g. Elf, Dragon"
            controlSize="sm"
            className="w-32"
          />
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-muted text-xs">Order by</span>
          <Select name="sort" defaultValue={sort} controlSize="sm">
            {COMMANDER_SORTS.map((mode) => (
              <option key={mode} value={mode}>
                {SORT_LABELS[mode]}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" name="store" value="1" defaultChecked={includeStore} />
          Also legends I don&apos;t own
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" name="real" value="1" defaultChecked={withReal} />
          Count my real cards
        </label>
        <Button type="submit" size="sm">
          Show
        </Button>
        {(colors.length > 0 || theme !== undefined || tribe !== "" || sort !== "coverage") && (
          <Link href="/decks/commanders" className="text-muted text-xs underline">
            Reset filters
          </Link>
        )}
      </form>

      {ranked.length === 0 ? (
        <p className="text-muted text-sm">
          {includeStore
            ? "No card that could lead a deck matches these filters."
            : "You don't own a card that could lead a deck matching these filters. Try “Also legends I don't own”."}
        </p>
      ) : (
        <>
          <p className="text-muted text-sm">
            {ranked.length} {ranked.length === 1 ? "commander" : "commanders"}
            {theme !== undefined && ` leading ${THEME_LABELS[theme]}`}
            {tribe !== "" && ` matching tribe “${tribe}”`}
            {colors.length > 0 && " with these colors"} · ordered by{" "}
            {SORT_LABELS[sort].toLowerCase()}.
          </p>
          <ul className="divide-border-subtle flex flex-col divide-y">
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
    </Page>
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
          <span className="text-muted text-xs" title="Color identity">
            ({<ManaText text={identity} />})
          </span>
          {commander.isGameChanger && (
            <span className="text-warning-ink rounded bg-amber-100 px-1.5 text-xs dark:bg-amber-950">
              Game Changer
            </span>
          )}
          {commander.edhrecRank !== null && commander.edhrecRank !== undefined && (
            <span
              className="bg-surface-raised text-muted rounded px-1.5 text-xs"
              title="Scryfall EDHREC popularity rank (lower is in more decks)"
            >
              EDHREC #{commander.edhrecRank.toLocaleString("en-US")}
            </span>
          )}
          {commander.ownedCopies === 0 && (
            <span className="bg-surface-raised text-muted rounded px-1.5 text-xs">
              not owned
              {commander.priceCents !== null &&
                ` · ${Cents.format(Cents.of(commander.priceCents))}`}
            </span>
          )}
        </div>
        <p className="text-muted text-xs italic">{commander.typeLine}</p>
        {paragraphs.length > 0 && (
          <div className="bg-surface text-foreground flex flex-col gap-1 rounded-md px-2.5 py-1.5 text-xs leading-relaxed">
            {paragraphs.map((paragraph, index) => (
              <p key={index}>
                <ManaText text={paragraph} />
              </p>
            ))}
          </div>
        )}
        <div className="text-muted flex flex-wrap items-center gap-1.5 text-xs">
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
                      ? "bg-accent text-accent-foreground"
                      : "bg-surface-raised hover:bg-surface-raised"
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
                      ? "bg-accent text-accent-foreground"
                      : "bg-surface-raised hover:bg-surface-raised"
                  }`}
                >
                  {tribeItem} kindred
                </Link>
              ))}
              {coverage.plan.keywords.map((keyword) => (
                <span key={keyword} className="bg-surface-raised rounded px-1.5 py-0.5">
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
          <span className="text-muted text-xs">
            {" "}
            · coverage {coverage.score} · power {coverage.powerScore}
          </span>
        </p>
        <ul className="flex flex-wrap gap-x-3 text-xs" aria-label="Roles">
          {coverage.roles.map((role) => (
            <li
              key={role.tag}
              className={role.have >= role.target ? "text-muted" : "text-warning-text"}
            >
              {TAG_LABELS[role.tag]} {role.have} of {role.target}
            </li>
          ))}
        </ul>
        {commander.leads.length > 0 && (
          <p className="text-muted text-xs">Already leads {commander.leads.join(", ")}.</p>
        )}
        <div className="flex flex-wrap items-start gap-2 pt-1">
          <form action={startDeckAction}>
            <input type="hidden" name="name" value={commander.name} />
            {props.withReal && <input type="hidden" name="real" value="1" />}
            <Button type="submit" size="sm">
              Start a deck
            </Button>
          </form>
          <CommanderCards oracleId={commander.oracleId} withReal={props.withReal} />
        </div>
      </div>
    </li>
  );
}
