"use client";
import { useEffect, useRef, useState } from "react";
import type { DeckDraft, DraftedSpell, Format } from "@/modules/decks";
import { Cents } from "@/shared/kernel";
import { ManaText } from "@/ui/mana";
import { draftReasonText, landReasonText, TAG_LABELS } from "../../labels";
import { draftDeckAction } from "./actions";
import type { LandsToAdd } from "./mana-base-panel";

// Draft deck panel (design doc 37, section 9): fills open slots up to 100 cards from owned cards
// first, then optional store cards for remaining gaps, plus a mana base from planManaBase.

const WAIT_MILLISECONDS = 400;

export function DraftPanel(props: {
  deckId: number;
  deckKey: string;
  format: Format;
  onAdd: (cards: LandsToAdd, count: number, label: string) => void;
  onClose: () => void;
  busy: boolean;
}) {
  const { deckId, deckKey } = props;
  const [includeStore, setIncludeStore] = useState<"fill-gaps" | "none">("fill-gaps");
  const [draft, setDraft] = useState<DeckDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);

  useEffect(() => {
    const request = ++latest.current;
    const timer = setTimeout(() => {
      setLoading(true);
      void draftDeckAction({ deckId, includeStore }).then((result) => {
        if (request !== latest.current) return;
        setDraft(result);
        setLoading(false);
      });
    }, WAIT_MILLISECONDS);
    return () => clearTimeout(timer);
  }, [deckId, deckKey, includeStore]);

  const roleSpells = draft?.spells.filter((spell) => spell.section === "role") ?? [];
  const planSpells = draft?.spells.filter((spell) => spell.section === "plan") ?? [];
  const curveSpells = draft?.spells.filter((spell) => spell.section === "curve") ?? [];
  const landsAddedCount = draft?.manaBase.add.reduce((sum, entry) => sum + entry.quantity, 0) ?? 0;
  const fullAdditions: LandsToAdd = draft
    ? [
        ...draft.spells.map((spell) => ({ oracleId: spell.oracleId, quantity: spell.quantity })),
        ...draft.manaBase.add.map((entry) => ({
          oracleId: entry.card.oracleId,
          quantity: entry.quantity,
        })),
      ]
    : [];
  const ownedOnlyAdditions: LandsToAdd = draft
    ? [
        ...draft.spells
          .filter((spell) => spell.pool === "owned")
          .map((spell) => ({ oracleId: spell.oracleId, quantity: spell.quantity })),
        ...draft.manaBase.add.map((entry) => ({
          oracleId: entry.card.oracleId,
          quantity: entry.quantity,
        })),
      ]
    : [];
  const sumQuantities = (spells: readonly DraftedSpell[]) =>
    spells.reduce((sum, spell) => sum + spell.quantity, 0);
  const ownedSpellCount = draft
    ? sumQuantities(draft.spells.filter((spell) => spell.pool === "owned"))
    : 0;
  const fullCount = (draft ? sumQuantities(draft.spells) : 0) + landsAddedCount;

  return (
    <section
      aria-label="Deck draft"
      className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800"
    >
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Draft deck</h2>
        <button
          type="button"
          onClick={props.onClose}
          aria-label="Close deck draft"
          className="text-muted hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          ✕
        </button>
      </div>
      <div className="rounded border border-amber-300 bg-amber-50/70 p-2 text-xs text-amber-950 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-200">
        <p className="font-medium">Heuristic starting point — requires investigation</p>
        <p className="mt-0.5 text-amber-900/90 dark:text-amber-200/90">
          This tool matches simple role/theme tags and mana curve slots without understanding how
          cards actually play together. Filling a deck directly from this draft as-is will make an
          awful, unfocused deck (especially <strong>Curve fill</strong> picks). Use it to pull an
          initial pile from your collection, then inspect the cards, cut the filler, and search for
          real synergies.
        </p>
      </div>
      <label className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300">
        <input
          type="checkbox"
          checked={includeStore === "fill-gaps"}
          onChange={(event) => setIncludeStore(event.target.checked ? "fill-gaps" : "none")}
          className="rounded border-zinc-300 dark:border-zinc-700"
        />
        Include store cards for gaps your collection can&apos;t fill
      </label>
      {draft === null ? (
        <p className="text-muted">
          {loading
            ? "Assembling draft…"
            : props.format === "commander"
              ? "Set a commander first to draft a 100-card Commander list."
              : "Drafting is available for constructed formats."}
        </p>
      ) : draft.existingCount >= draft.targetTotal ? (
        <p className="text-muted">This deck already has {draft.existingCount} cards.</p>
      ) : (
        <>
          <div className="flex flex-col gap-1 rounded bg-zinc-50 p-2 text-xs dark:bg-zinc-900">
            <p className="font-medium">
              Existing: {draft.existingCount} · Owned spells: +{ownedSpellCount}
              {draft.storeAddedCount > 0 && (
                <>
                  {" "}
                  · Store spells: +{draft.storeAddedCount} (
                  {Cents.format(Cents.of(draft.storeCostCents))})
                </>
              )}{" "}
              · Lands: +{landsAddedCount} → Total: {draft.totalAfterDraft}
            </p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {draft.roleSummary.map((role) => (
                <span
                  key={role.tag}
                  className={`rounded px-1.5 py-0.5 ${
                    role.total >= role.target
                      ? "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200"
                      : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                  }`}
                >
                  {TAG_LABELS[role.tag]} {role.total}/{role.target}
                  {role.storeAdded > 0 ? ` (${role.storeAdded} store)` : ""}
                </span>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {fullCount > 0 && (
              <button
                type="button"
                disabled={props.busy}
                onClick={() =>
                  props.onAdd(fullAdditions, fullCount, `Added ${fullCount} drafted cards.`)
                }
                className="rounded-md bg-zinc-900 px-3 py-1 text-sm text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
              >
                {draft.storeAddedCount > 0
                  ? `Add full draft (${fullCount} cards, ${Cents.format(Cents.of(draft.storeCostCents))} store)`
                  : `Add draft to deck (${fullCount} cards)`}
              </button>
            )}
            {draft.storeAddedCount > 0 && draft.ownedAddedCount > 0 && (
              <button
                type="button"
                disabled={props.busy}
                onClick={() =>
                  props.onAdd(
                    ownedOnlyAdditions,
                    draft.ownedAddedCount,
                    `Added ${draft.ownedAddedCount} owned cards and lands.`,
                  )
                }
                className="rounded-md border border-zinc-300 px-3 py-1 text-sm disabled:opacity-40 dark:border-zinc-700"
              >
                Add owned + lands only ({draft.ownedAddedCount} cards)
              </button>
            )}
          </div>

          {roleSpells.length > 0 && (
            <SpellSection title={`Role picks (${sumQuantities(roleSpells)})`} spells={roleSpells} />
          )}
          {planSpells.length > 0 && (
            <SpellSection
              title={`On-plan spells (${sumQuantities(planSpells)})`}
              spells={planSpells}
            />
          )}
          {curveSpells.length > 0 && (
            <SpellSection
              title={`Curve fill (${sumQuantities(curveSpells)})`}
              spells={curveSpells}
            />
          )}
          {draft.manaBase.add.length > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="text-muted text-xs font-medium uppercase">
                Lands (+{landsAddedCount})
              </h3>
              <ul className="flex flex-col gap-1">
                {draft.manaBase.add.map((land) => (
                  <li key={land.card.oracleId} className="text-xs">
                    <span className="font-medium">
                      {land.quantity > 1 ? `${land.quantity} ` : ""}
                      {land.card.name}
                    </span>
                    <span className="text-muted">
                      {" · "}
                      {[
                        ...land.reasons.map(landReasonText),
                        ...(land.card.alsoIn.length > 0
                          ? [`also in ${land.card.alsoIn.join(", ")}`]
                          : []),
                      ].join(" · ")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function SpellSection(props: { title: string; spells: readonly DraftedSpell[] }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-muted text-xs font-medium uppercase">{props.title}</h3>
      <ul className="flex flex-col gap-1.5">
        {props.spells.map((spell) => (
          <li key={spell.oracleId}>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium">
                {spell.quantity > 1 ? `${spell.quantity}× ` : ""}
                {spell.name}
              </span>
              {spell.manaCost !== null && spell.manaCost !== "" && (
                <span className="text-xs">
                  <ManaText text={spell.manaCost} />
                </span>
              )}
              {spell.pool === "store" && (
                <span className="rounded bg-amber-100 px-1 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                  store
                  {spell.priceCents !== null
                    ? ` · ${Cents.format(Cents.of(spell.priceCents))}`
                    : ""}
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              {[
                ...spell.reasons.map(draftReasonText),
                ...(spell.alsoIn.length > 0 ? [`also in ${spell.alsoIn.join(", ")}`] : []),
              ].join(" · ")}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
