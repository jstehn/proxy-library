"use client";
import type { DeckLine } from "@/modules/decks";
import {
  deckStats,
  MANA_COLORS,
  deckSize,
  roleTargets,
  TARGETED_TAGS,
  suggestedLands,
  TYPE_ORDER,
  type ManaSource,
} from "@/modules/decks/client";
import { TAGS, type Tag } from "@/shared/card-search";
import { Cents } from "@/shared/kernel";
import { ManaText } from "@/ui/mana";
import { TAG_LABELS } from "../../labels";

// Live deck statistics (design doc 14, section 2.5): recomputed in the browser from the deck in
// hand, so they change the moment a card goes in or out.

const COLOR_BAR: Record<ManaSource, string> = {
  W: "bg-amber-200",
  U: "bg-sky-500",
  B: "bg-zinc-500",
  R: "bg-red-500",
  G: "bg-green-600",
  C: "bg-stone-400",
};

export function StatsPanel(props: {
  lines: readonly DeckLine[];
  format: string;
  /** The role whose cards the deck list highlights, if any. */
  highlighted: Tag | null;
  onHighlight: (tag: Tag | null) => void;
}) {
  const stats = deckStats(props.lines);
  const targets = roleTargets(props.format);
  const untargeted = TAGS.filter(
    (tag) => !(TARGETED_TAGS as readonly Tag[]).includes(tag) && stats.tags[tag] > 0,
  );
  const roleButton = (tag: Tag) =>
    `text-left underline-offset-2 hover:underline ${props.highlighted === tag ? "font-semibold underline" : ""}`;
  const toggle = (tag: Tag) => props.onHighlight(props.highlighted === tag ? null : tag);
  const target = deckSize(props.format);
  const landGoal = suggestedLands(props.format);
  const tallest = Math.max(...stats.curve, 1);
  const neededColors = MANA_COLORS.filter((color) => stats.pips[color] > 0);
  const mostPips = Math.max(...MANA_COLORS.map((color) => stats.pips[color]), 1);
  const mostSources = Math.max(...MANA_COLORS.map((color) => stats.sources[color]), 1);

  return (
    <section aria-label="Deck statistics" className="flex flex-col gap-4 text-sm">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
        <Figure
          label="Cards"
          value={`${stats.cardCount} / ${target.cards}`}
          tone={
            stats.cardCount === target.cards || (!target.exact && stats.cardCount > target.cards)
              ? "good"
              : "warn"
          }
        />
        <Figure label="Average mana value" value={stats.averageManaValue.toFixed(2)} />
        <Figure
          label="Lands"
          value={`${stats.lands} (aim ~${landGoal})`}
          tone={Math.abs(stats.lands - landGoal) <= 2 ? "good" : "warn"}
        />
        <Figure label="Other mana sources" value={String(stats.otherManaSources)} />
        <Figure label="Price" value={Cents.format(Cents.of(stats.priceCents))} />
      </dl>

      <div className="flex flex-col gap-1">
        <h3 className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Mana curve</h3>
        <div
          className="flex h-24 items-end gap-1"
          role="img"
          aria-label={`Mana curve: ${stats.curve.join(", ")} spells at mana value 0 to 7 or more`}
        >
          {stats.curve.map((count, manaValue) => {
            const creatures = stats.creatureCurve[manaValue];
            return (
              <div
                key={manaValue}
                className="flex flex-1 flex-col items-center justify-end gap-0.5"
              >
                {count > 0 && <span className="text-[10px] tabular-nums">{count}</span>}
                <div
                  className="flex w-full flex-col justify-end overflow-hidden rounded-t"
                  style={{ height: `${(count / tallest) * 72}px` }}
                >
                  <div className="bg-sky-300 dark:bg-sky-700" style={{ flex: count - creatures }} />
                  <div className="bg-sky-600 dark:bg-sky-400" style={{ flex: creatures }} />
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex gap-1 text-[10px] text-zinc-500">
          {stats.curve.map((_, manaValue) => (
            <span key={manaValue} className="flex-1 text-center">
              {manaValue === 7 ? "7+" : manaValue}
            </span>
          ))}
        </div>
        <p className="flex gap-3 text-[10px] text-zinc-500">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 bg-sky-600 dark:bg-sky-400" /> creatures
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 bg-sky-300 dark:bg-sky-700" /> other spells
          </span>
        </p>
      </div>

      {neededColors.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
            Colors: needed vs. made
          </h3>
          {neededColors.map((color) => (
            <div key={color} className="grid grid-cols-[1.5rem_1fr_1fr] items-center gap-2">
              <ManaText text={`{${color}}`} />
              <Bar
                share={stats.pips[color] / mostPips}
                color={COLOR_BAR[color]}
                label={`${stats.pips[color]} symbols`}
              />
              <Bar
                share={stats.sources[color] / mostSources}
                color={COLOR_BAR[color]}
                label={`${stats.sources[color]} sources`}
              />
            </div>
          ))}
          <p className="text-[10px] text-zinc-500">
            Left: colored symbols in your spells&apos; costs. Right: lands and other cards that make
            that color.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <h3 className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Roles</h3>
        {TARGETED_TAGS.map((tag) => {
          const count = stats.tags[tag];
          if (targets === null) {
            // No common guide for this format: the count alone, without a bar.
            return (
              <div key={tag} className="grid grid-cols-[6.5rem_1fr] items-center gap-2">
                <button
                  type="button"
                  aria-pressed={props.highlighted === tag}
                  onClick={() => toggle(tag)}
                  className={roleButton(tag)}
                >
                  {TAG_LABELS[tag]}
                </button>
                <span className="tabular-nums">{count}</span>
              </div>
            );
          }
          const target = targets[tag];
          return (
            <div key={tag} className="grid grid-cols-[6.5rem_1fr_3.5rem] items-center gap-2">
              <button
                type="button"
                aria-pressed={props.highlighted === tag}
                onClick={() => toggle(tag)}
                className={roleButton(tag)}
              >
                {TAG_LABELS[tag]}
              </button>
              <div className="h-2 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-800">
                <div
                  className={`h-full ${count >= target ? "bg-green-600 dark:bg-green-500" : "bg-amber-500"}`}
                  style={{ width: `${Math.min(1, count / target) * 100}%` }}
                />
              </div>
              <span
                className={`text-right tabular-nums ${count >= target ? "" : "text-amber-700 dark:text-amber-400"}`}
                aria-label={`${count} of about ${target}`}
              >
                {count} / {target}
              </span>
            </div>
          );
        })}
        {untargeted.length > 0 && (
          <p className="flex flex-wrap gap-x-3">
            {untargeted.map((tag) => (
              <button
                key={tag}
                type="button"
                aria-pressed={props.highlighted === tag}
                onClick={() => toggle(tag)}
                className={roleButton(tag)}
              >
                {TAG_LABELS[tag]} {stats.tags[tag]}
              </button>
            ))}
          </p>
        )}
        <p className="text-[10px] text-zinc-500">
          Read from each card&apos;s rules text, so a few may be missed or miscounted.{" "}
          {targets === null
            ? "Only Commander has a common guide to aim for, so other formats show counts alone."
            : "The targets are a common Commander guide."}{" "}
          Click a role to mark its cards in the list.
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <h3 className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Types</h3>
        <dl className="flex flex-wrap gap-x-3 gap-y-1">
          {[...TYPE_ORDER, "Other"]
            .filter((type) => (stats.types[type] ?? 0) > 0)
            .map((type) => (
              <div key={type} className="flex gap-1">
                <dt className="text-zinc-500">{type}</dt>
                <dd className="tabular-nums">{stats.types[type]}</dd>
              </div>
            ))}
        </dl>
      </div>
    </section>
  );
}

function Figure(props: { label: string; value: string; tone?: "good" | "warn" }) {
  const color =
    props.tone === "good"
      ? "text-green-700 dark:text-green-400"
      : props.tone === "warn"
        ? "text-amber-700 dark:text-amber-400"
        : "";
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-zinc-500">{props.label}</dt>
      <dd className={`font-medium tabular-nums ${color}`}>{props.value}</dd>
    </div>
  );
}

function Bar(props: { share: number; color: string; label: string }) {
  return (
    <div className="flex items-center gap-1" title={props.label}>
      <div className="h-2 flex-1 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-800">
        <div className={`h-full ${props.color}`} style={{ width: `${props.share * 100}%` }} />
      </div>
      <span className="w-6 text-right text-[10px] tabular-nums">{props.label.split(" ")[0]}</span>
    </div>
  );
}
