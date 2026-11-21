import Link from "next/link";
import { COMMANDER_SORTS, type CommanderSort } from "@/modules/decks";
import { COLORS, type ManaColor, THEME_LABELS, THEMES } from "@/shared/mtg";
import { Button } from "@/ui/button";
import { Input, Select } from "@/ui/field";
import { ManaText } from "@/ui/mana";
import { COMMANDERS_PATH, type CommanderFilters } from "./search";

const COLOR_NAMES: Record<ManaColor, string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
};

export const SORT_LABELS: Readonly<Record<CommanderSort, string>> = {
  coverage: "Cards I own (coverage)",
  combined: "Blend (coverage + popularity + power)",
  popularity: "Popularity (EDHREC rank)",
  power: "Power heuristic (Game Changer & card strength)",
};

/** The filter form: colours, theme, tribe, order, and whether to include legends you don't own. */
export function CommanderFilterForm(props: { filters: CommanderFilters }) {
  const { colors, theme, tribe, sort, includeStore, withReal } = props.filters;
  return (
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
        <Link href={COMMANDERS_PATH} className="text-muted text-xs underline">
          Reset filters
        </Link>
      )}
    </form>
  );
}
