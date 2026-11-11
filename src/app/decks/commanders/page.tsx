import Link from "next/link";
import { commandersICanBuild, SPELL_SLOTS, type CommanderCoverage } from "@/modules/decks";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { Cents } from "@/shared/kernel";
import { Alert } from "@/ui/form";
import { ManaStylesheet, ManaText } from "@/ui/mana";
import { planText, TAG_LABELS } from "../labels";
import { startDeckAction } from "./actions";
import { CommanderCards } from "./commander-cards";

// Decks → Find a commander (design doc 36, section 9): the cards that could lead a deck, the
// ones your collection covers most of first. Simple counts over rules text: ideas to look at.

const COLORS = ["W", "U", "B", "R", "G"] as const;
type Color = (typeof COLORS)[number];
const COLOR_NAMES: Record<Color, string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
};

/** How many rows each "Show more" adds. */
const PAGE = 25;

function chosenColors(value: string | string[] | undefined): Color[] {
  const text = Array.isArray(value) ? value.join("") : (value ?? "");
  return COLORS.filter((color) => text.includes(color));
}

export default async function FindCommanderPage(props: PageProps<"/decks/commanders">) {
  const actor = await requireActor();
  const searchParams = await props.searchParams;
  const colors = chosenColors(searchParams.colors);
  const includeStore = searchParams.store === "1";
  const withReal = searchParams.real === "1";
  const shown = Math.max(PAGE, Number(searchParams.show) || PAGE);
  const ranked = await commandersICanBuild(getContainer().db, actor.userId, {
    colors,
    includeStore,
    withReal,
  });
  const error = searchParams.error;

  const query = (show: number) => {
    const params = new URLSearchParams();
    if (colors.length > 0) params.set("colors", colors.join(""));
    if (includeStore) params.set("store", "1");
    if (withReal) params.set("real", "1");
    params.set("show", String(show));
    return `/decks/commanders?${params.toString()}`;
  };

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-12">
      <ManaStylesheet />
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Find a commander</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Cards that could lead a Commander deck, the ones your collection already covers most of
          first: cards that share what the commander&apos;s text cares about, ramp, draw, removal
          and wipes, and how many of a deck&apos;s {SPELL_SLOTS} spells your cards could fill. Every
          copy you own counts, even ones in other decks. Simple counts over rules text: ideas to
          look at, not a verdict.{" "}
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
      </form>

      {ranked.length === 0 ? (
        <p className="text-sm text-zinc-500">
          {includeStore
            ? "No card that could lead a deck matches these colors."
            : "You don't own a card that could lead a deck in these colors. Try “Also legends I don't own”."}
        </p>
      ) : (
        <>
          <p className="text-sm text-zinc-500">
            {ranked.length} {ranked.length === 1 ? "commander" : "commanders"}
            {colors.length > 0 && " with these colors"}.
          </p>
          <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
            {ranked.slice(0, shown).map((coverage) => (
              <CommanderRow
                key={coverage.commander.oracleId}
                coverage={coverage}
                withReal={withReal}
              />
            ))}
          </ul>
          {ranked.length > shown && (
            <Link
              href={query(shown + PAGE)}
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

function CommanderRow(props: { coverage: CommanderCoverage; withReal: boolean }) {
  const { coverage } = props;
  const { commander } = coverage;
  const plan = planText(coverage.plan);
  const identity =
    commander.colorIdentity.length === 0
      ? "{C}"
      : commander.colorIdentity.map((color) => `{${color}}`).join("");
  return (
    <li className="flex gap-3 py-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/images/${commander.printingId}/small/front`}
        alt=""
        loading="lazy"
        className="aspect-[146/204] w-16 shrink-0 self-start rounded-[4.5%] bg-zinc-100 sm:w-20 dark:bg-zinc-800"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium">{commander.name}</span>
          <ManaText text={identity} />
          {commander.isGameChanger && (
            <span className="rounded bg-amber-100 px-1.5 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              Game Changer
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
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          {plan === "" ? "No plan read from its text." : `Leads: ${plan}`}
        </p>
        <p>
          <span className="font-medium">{coverage.onPlan}</span> on-plan ·{" "}
          <span className="font-medium">
            {coverage.filled} of {SPELL_SLOTS}
          </span>{" "}
          spells from your cards · {coverage.ownedLands}{" "}
          {coverage.ownedLands === 1 ? "land" : "lands"}
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
