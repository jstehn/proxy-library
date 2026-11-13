"use client";
import type { Bracket, BracketEstimate, BracketRule } from "@/modules/decks";
import { BRACKET_NAMES, BRACKETS, bracketWarning } from "@/modules/decks/client";
import { estimateLabel, findingText, uncheckedText } from "../../labels";

// The Commander bracket (design doc 31, section 5.2): the lowest bracket the cards allow, why,
// and the bracket the owner is aiming for. Worked out in the browser, like the statistics.

export function BracketPanel(props: {
  estimate: BracketEstimate;
  target: Bracket | null;
  /** Leave out to show the target without a way to change it (a shared deck). */
  onTargetChange?: (target: Bracket | null) => void;
  saving?: boolean;
  /** The rule whose cards the deck list marks, if any. */
  highlighted: BracketRule | null;
  onHighlight: (rule: BracketRule | null) => void;
}) {
  const { estimate, target } = props;
  const warning = bracketWarning(estimate, target);
  const toggle = (rule: BracketRule) => props.onHighlight(props.highlighted === rule ? null : rule);

  return (
    <section aria-label="Commander bracket" className="flex flex-col gap-1 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-muted text-xs font-medium tracking-wide uppercase">Bracket</h3>
        {props.onTargetChange !== undefined ? (
          <label className="text-muted flex items-center gap-1 text-xs">
            Target
            <select
              value={target ?? ""}
              disabled={props.saving}
              onChange={(event) =>
                props.onTargetChange?.(
                  event.target.value === "" ? null : (Number(event.target.value) as Bracket),
                )
              }
              className="rounded border border-zinc-300 bg-white px-1 py-0.5 text-xs text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            >
              <option value="">none</option>
              {BRACKETS.map((bracket) => (
                <option key={bracket} value={bracket}>
                  {bracket} · {BRACKET_NAMES[bracket]}
                </option>
              ))}
            </select>
          </label>
        ) : (
          target !== null && (
            <span className="text-muted text-xs">
              Built for bracket {target} · {BRACKET_NAMES[target]}
            </span>
          )
        )}
      </div>

      <p className="font-medium">
        {estimateLabel(estimate)} <span className="text-muted font-normal">(at least)</span>
      </p>

      {warning !== null && (
        <p
          role="status"
          className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
        >
          ⚠ Over {props.onTargetChange === undefined ? "its" : "your"} target (bracket{" "}
          {warning.target}): the reasons in amber below.
        </p>
      )}

      {estimate.findings.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {estimate.findings.map((finding) => (
            <li key={finding.rule}>
              <button
                type="button"
                aria-pressed={props.highlighted === finding.rule}
                onClick={() => toggle(finding.rule)}
                className={`text-left underline-offset-2 hover:underline ${props.highlighted === finding.rule ? "font-semibold underline" : ""} ${target !== null && finding.forces > target ? "text-amber-700 dark:text-amber-400" : ""}`}
              >
                {findingText(finding)}
              </button>
              <span className="text-muted">: {finding.cards.join(", ")}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="text-muted text-[10px]">
        Game Changers come from Wizards&apos; list; land denial and extra turns are read from rules
        text. {uncheckedText(estimate.unchecked)}
        {estimate.findings.length > 0 && " Click a reason to mark its cards in the list."}
      </p>
    </section>
  );
}
