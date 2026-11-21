"use client";
import { useEffect, useState, useTransition } from "react";
import type { PrintingCard } from "@/modules/catalog";
import type { DeckLine } from "@/modules/decks";
import { NamePreview } from "@/app/_components/card-preview";
import { settle, valueOr } from "../answer";
import { deckPlanAction, saveDeckPlanAction, type DeckPlanWithPrimer } from "./actions";
import {
  formatNamedLines,
  nonEmptyLines,
  parseInline,
  parseNamedLines,
  parsePrimer,
  withSuggestedSections,
  type PrimerInline,
} from "./primer-text";
import { Button } from "@/ui/button";
import { Card } from "@/ui/card";

// The deck's plan and primer (design doc 61): what the deck is trying to do, the cards that must
// stay and the ones to keep out (the MCP tools read these too), and free-form notes in Markdown
// with [[Card Name]] links that preview the card.

type Props = Readonly<{
  deckId: number;
  lines: readonly DeckLine[];
  cards: Readonly<Record<string, PrintingCard>>;
  onError: (text: string) => void;
  onSaved: (text: string) => void;
  onClose: () => void;
}>;

/** The editor's text fields, one textarea per list. */
type Draft = Readonly<{
  plan: string;
  winCons: string;
  keyCards: string;
  avoid: string;
  declaredCombos: string;
  mulligan: string;
  pilotNotes: string;
  primer: string;
}>;

function draftOf(plan: DeckPlanWithPrimer): Draft {
  const { profile } = plan;
  return {
    plan: profile.plan ?? "",
    winCons: profile.winCons.join("\n"),
    keyCards: formatNamedLines(profile.keyCards),
    avoid: formatNamedLines(profile.avoid),
    declaredCombos: profile.declaredCombos.join("\n"),
    mulligan: profile.mulligan ?? "",
    pilotNotes: profile.pilotNotes ?? "",
    primer: plan.primer,
  };
}

function isEmptyPlan(plan: DeckPlanWithPrimer): boolean {
  const { profile } = plan;
  return (
    plan.primer.trim() === "" &&
    (profile.plan ?? "") === "" &&
    profile.winCons.length === 0 &&
    profile.keyCards.length === 0 &&
    profile.avoid.length === 0 &&
    profile.declaredCombos.length === 0 &&
    (profile.mulligan ?? "") === "" &&
    (profile.pilotNotes ?? "") === ""
  );
}

export function PrimerPanel(props: Props) {
  const { deckId } = props;
  const [plan, setPlan] = useState<DeckPlanWithPrimer | null | "loading">("loading");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [isSaving, startSaving] = useTransition();

  useEffect(() => {
    let current = true;
    void deckPlanAction(deckId).then((loaded) => {
      if (current) setPlan(valueOr(loaded, null));
    });
    return () => {
      current = false;
    };
  }, [deckId]);

  const links: CardLinks = { lines: props.lines, cards: props.cards };

  /** Sets one editor field from the latest draft, so quick edits never undo each other. */
  function update(field: keyof Draft, value: string) {
    setDraft((current) => (current === null ? current : { ...current, [field]: value }));
  }

  function save(event: React.FormEvent) {
    event.preventDefault();
    if (draft === null) return;
    startSaving(async () => {
      const result = settle(
        await saveDeckPlanAction({
          deckId,
          plan: draft.plan.trim() === "" ? null : draft.plan,
          winCons: nonEmptyLines(draft.winCons),
          keyCards: parseNamedLines(draft.keyCards),
          avoid: parseNamedLines(draft.avoid),
          declaredCombos: nonEmptyLines(draft.declaredCombos),
          mulligan: draft.mulligan.trim() === "" ? null : draft.mulligan,
          pilotNotes: draft.pilotNotes.trim() === "" ? null : draft.pilotNotes,
          primer: draft.primer,
        }),
        "Something there is too long or empty; check the fields.",
      );
      if (result.ok) {
        setPlan(result.value);
        setDraft(null);
        props.onSaved("Plan and primer saved.");
      } else {
        props.onError(result.error.message);
      }
    });
  }

  const stackedLabel = "flex flex-col gap-1";
  const label = "text-muted text-xs font-medium";
  const input = "rounded border border-line bg-transparent px-2 py-1 text-sm";

  return (
    <Card aria-label="Plan and primer" as="section" padding="md" stack className="text-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-medium">Plan &amp; primer</h2>
        <div className="flex items-center gap-1">
          {plan !== null && plan !== "loading" && draft === null && (
            <Button
              type="button"
              onClick={() => setDraft(draftOf(plan))}
              variant="secondary"
              size="sm"
            >
              Edit
            </Button>
          )}
          <button
            type="button"
            onClick={props.onClose}
            aria-label="Close plan and primer"
            className="text-muted hover:text-foreground min-h-7 min-w-7 rounded px-1.5"
          >
            ✕
          </button>
        </div>
      </div>

      {plan === "loading" && <p className="text-muted">Loading the plan…</p>}
      {plan === null && <p className="text-muted">Couldn&apos;t load this deck&apos;s plan.</p>}

      {plan !== null && plan !== "loading" && draft === null && (
        <div className="flex flex-col gap-3">
          {isEmptyPlan(plan) ? (
            <p className="text-muted">
              No plan yet. Write what the deck is trying to do, the cards it can&apos;t lose, and
              the ones to keep out: the deck tools read them before suggesting changes.
            </p>
          ) : (
            <>
              {plan.profile.plan !== null && plan.profile.plan !== "" && (
                <p>
                  <Inline links={links} runs={parseInline(plan.profile.plan)} />
                </p>
              )}
              <PlanList title="How it wins" items={plan.profile.winCons} links={links} />
              <NamedList
                title="Key cards (never cut)"
                items={plan.profile.keyCards}
                links={links}
              />
              <NamedList title="Keep out" items={plan.profile.avoid} links={links} />
              <PlanList
                title="Combos (for bracket disclosure)"
                items={plan.profile.declaredCombos}
                links={links}
              />
              {plan.profile.mulligan && <PlanText title="Mulligan" text={plan.profile.mulligan} />}
              {plan.profile.pilotNotes && (
                <PlanText title="Pilot notes" text={plan.profile.pilotNotes} />
              )}
              {plan.primer.trim() !== "" && (
                <div className="border-border-subtle flex flex-col gap-2 border-t pt-3">
                  {parsePrimer(plan.primer).map((block, index) =>
                    block.kind === "heading" ? (
                      block.level === 2 ? (
                        <h3 key={index} className="mt-1 font-medium">
                          <Inline links={links} runs={block.content} />
                        </h3>
                      ) : (
                        <h4 key={index} className="text-muted text-xs font-medium uppercase">
                          <Inline links={links} runs={block.content} />
                        </h4>
                      )
                    ) : block.kind === "list" ? (
                      <ul key={index} className="flex list-disc flex-col gap-0.5 pl-5">
                        {block.items.map((item, itemIndex) => (
                          <li key={itemIndex}>
                            <Inline links={links} runs={item} />
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p key={index} className="break-words">
                        <Inline links={links} runs={block.content} />
                      </p>
                    ),
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {draft !== null && (
        <form onSubmit={save} className="flex flex-col gap-3">
          <label className={stackedLabel}>
            <span className={label}>Plan (a sentence or two)</span>
            <textarea
              rows={2}
              maxLength={600}
              value={draft.plan}
              onChange={(event) => update("plan", event.target.value)}
              placeholder="Blitz value with sacrifice and recursion; win through combat and drain."
              className={input}
            />
          </label>
          <label className={stackedLabel}>
            <span className={label}>How it wins (one per line)</span>
            <textarea
              rows={3}
              value={draft.winCons}
              onChange={(event) => update("winCons", event.target.value)}
              placeholder="Avacyn + free sac outlet + Zulaport drain"
              className={input}
            />
          </label>
          <label className={stackedLabel}>
            <span className={label}>Key cards, never cut (Card — reason, one per line)</span>
            <textarea
              rows={3}
              value={draft.keyCards}
              onChange={(event) => update("keyCards", event.target.value)}
              placeholder="Avacyn, Angel of Horror — the recursion engine"
              className={input}
            />
          </label>
          <label className={stackedLabel}>
            <span className={label}>Keep out (Card — reason, one per line)</span>
            <textarea
              rows={2}
              value={draft.avoid}
              onChange={(event) => update("avoid", event.target.value)}
              placeholder="Mortuary — breaks Avacyn and reanimation"
              className={input}
            />
          </label>
          <label className={stackedLabel}>
            <span className={label}>Combos in the deck (one per line)</span>
            <textarea
              rows={2}
              value={draft.declaredCombos}
              onChange={(event) => update("declaredCombos", event.target.value)}
              placeholder="Avacyn, Angel of Horror + Viscera Seer + Zulaport Cutthroat"
              className={input}
            />
          </label>
          <label className={stackedLabel}>
            <span className={label}>Mulligan</span>
            <textarea
              rows={2}
              maxLength={1000}
              value={draft.mulligan}
              onChange={(event) => update("mulligan", event.target.value)}
              className={input}
            />
          </label>
          <label className={stackedLabel}>
            <span className={label}>Pilot notes</span>
            <textarea
              rows={2}
              maxLength={2000}
              value={draft.pilotNotes}
              onChange={(event) => update("pilotNotes", event.target.value)}
              className={input}
            />
          </label>
          <div className={stackedLabel}>
            <div className="flex items-baseline justify-between gap-2">
              <label htmlFor={`primer-${deckId}`} className={label}>
                Primer (Markdown: ## headings, - lists, **bold**, [[Card Name]])
              </label>
              <button
                type="button"
                onClick={() =>
                  setDraft((current) =>
                    current === null
                      ? current
                      : { ...current, primer: withSuggestedSections(current.primer) },
                  )
                }
                className="text-xs underline underline-offset-2"
              >
                Add suggested sections
              </button>
            </div>
            <textarea
              id={`primer-${deckId}`}
              rows={10}
              maxLength={20_000}
              value={draft.primer}
              onChange={(event) => update("primer", event.target.value)}
              className={`${input} font-mono text-xs`}
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={isSaving} variant="secondary" size="sm">
              {isSaving ? "Saving…" : "Save"}
            </Button>
            <Button
              type="button"
              disabled={isSaving}
              onClick={() => setDraft(null)}
              variant="secondary"
              size="sm"
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

function PlanList(props: { title: string; items: readonly string[]; links: CardLinks }) {
  if (props.items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-muted text-xs font-medium">{props.title}</h3>
      <ul className="flex list-disc flex-col gap-0.5 pl-5">
        {props.items.map((item, index) => (
          <li key={index}>
            <Inline links={props.links} runs={parseInline(item)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function NamedList(props: {
  title: string;
  items: readonly Readonly<{ cardName: string; reason: string }>[];
  links: CardLinks;
}) {
  if (props.items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-muted text-xs font-medium">{props.title}</h3>
      <ul className="flex flex-col gap-0.5">
        {props.items.map((item) => (
          <li key={item.cardName}>
            <CardName links={props.links} name={item.cardName} />
            {item.reason !== "" && <span className="text-muted"> — {item.reason}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PlanText(props: { title: string; text: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-muted text-xs font-medium">{props.title}</h3>
      <p className="break-words whitespace-pre-line">{props.text}</p>
    </div>
  );
}

/** What a [[Card Name]] needs to preview the card: the deck's lines and their printings. */
type CardLinks = Readonly<{
  lines: readonly DeckLine[];
  cards: Readonly<Record<string, PrintingCard>>;
}>;

/** A card name linked to its preview when the deck holds it, else plain bold text. */
function CardName(props: { name: string; links: CardLinks }) {
  const needle = props.name.toLowerCase();
  const line = props.links.lines.find((each) => {
    const name = each.name.toLowerCase();
    return name === needle || name.split(" // ").includes(needle);
  });
  if (line === undefined) {
    return (
      <strong title="Not in this deck" className="font-semibold">
        {props.name}
      </strong>
    );
  }
  return (
    <NamePreview
      printing={props.links.cards[line.printingId]}
      name={props.name}
      className="inline font-semibold underline decoration-dotted underline-offset-2"
    />
  );
}

/** Plain, bold and card-link runs of primer text. */
function Inline(props: { runs: readonly PrimerInline[]; links: CardLinks }) {
  return (
    <>
      {props.runs.map((run, index) =>
        run.kind === "card" ? (
          <CardName key={index} name={run.name} links={props.links} />
        ) : run.kind === "bold" ? (
          <strong key={index}>{run.text}</strong>
        ) : (
          <span key={index}>{run.text}</span>
        ),
      )}
    </>
  );
}
