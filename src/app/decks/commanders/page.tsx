import Link from "next/link";
import { SPELL_SLOTS } from "@/modules/decks";
import { readPage } from "@/server/page-instance";
import { THEME_LABELS } from "@/shared/mtg";
import { Alert } from "@/ui/form";
import { ManaStylesheet } from "@/ui/mana";
import { Page } from "@/ui/page";
import { CommanderFilterForm, SORT_LABELS } from "./_components/commander-filters";
import { CommanderRow } from "./_components/commander-row";
import { commandersUrl, PAGE, readFilters } from "./_components/search";

// Decks → Find a commander (design docs 36 and 39): the cards that could lead a deck, with
// Oracle text, hover card preview, theme/tribe filtering, and coverage / popularity / power ordering.

export default async function FindCommanderPage(props: PageProps<"/decks/commanders">) {
  const { actor, reads } = await readPage();
  const searchParams = await props.searchParams;
  const { filters, shown } = readFilters(searchParams);
  const { theme, tribe, sort, colors, includeStore, withReal } = filters;
  const ranked = await reads.decks.commandersICanBuild(actor, {
    colors,
    theme,
    tribe: tribe || undefined,
    sort,
    includeStore,
    withReal,
  });
  const error = searchParams.error;

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
      <CommanderFilterForm filters={filters} />

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
                buildUrl={(overrides) => commandersUrl(filters, overrides)}
              />
            ))}
          </ul>
          {ranked.length > shown && (
            <Link
              href={commandersUrl(filters, { show: shown + PAGE })}
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
