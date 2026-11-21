import Link from "next/link";
import { SPELL_SLOTS, type CommanderCoverage } from "@/modules/decks";
import { Cents } from "@/shared/kernel";
import { type Theme, THEME_LABELS } from "@/shared/mtg";
import { Button } from "@/ui/button";
import { ManaText } from "@/ui/mana";
import { planText, TAG_LABELS } from "../../labels";
import { startDeckAction } from "../actions";
import { CommanderCards, CommanderThumbnail } from "./commander-cards";

/** One commander in the list: its text, its plan, what you cover, and the buttons. */
export function CommanderRow(props: {
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
