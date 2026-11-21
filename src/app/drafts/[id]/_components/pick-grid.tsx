"use client";
import { useState, useTransition } from "react";
import type { PrintingCard } from "@/modules/catalog";
import type { CardRef, PickChoices, PickOptions } from "@/modules/drafts";
import { abilityOf, isCreatureLine } from "@/modules/drafts/client";
import { EnlargedCard } from "@/app/_components/card-preview";
import { Button } from "@/ui/button";
import { Input, Select } from "@/ui/field";
import { decideAction, pickAction } from "../../actions";
import { CardImage } from "@/ui/mtg/card-image";

const CARD_FACE = "bg-surface-raised aspect-[146/204] w-full rounded-[4.5%]";
const FOIL_SHEEN = "bg-gradient-to-br from-fuchsia-400/35 via-transparent to-cyan-300/40";
const DASHED_BOX = "flex flex-col items-start gap-2 rounded-md border border-dashed p-4 text-sm";

// The pack in front of you (design docs 17 and 18). Tap a card to see it large and the choices
// its draft abilities give you, then "Pick"; a double click picks with no choices. While an
// Archdemon of Paliano is face up you can't see the pack: you draw at random, then choose.

export type PackCardView = Readonly<{ slot: number; finish: string; printing: PrintingCard }>;

/** Where a Lore Seeker's pack can come from, for the select. */
export type LoreSources = Readonly<{
  inventory: ReadonlyArray<{ itemId: number; name: string }>;
  buy: ReadonlyArray<{ setCode: string; boosterType: string; label: string }>;
}>;

export type ChoiceContext = Readonly<{
  options: PickOptions;
  /** Names of your face-up cards that can note a card, by "pack:slot". */
  cardNames: Readonly<Record<string, string>>;
  seatNames: Readonly<Record<number, string>>;
  turn: Readonly<{ extraCards: number; wholePack: boolean }> | null;
  lore: LoreSources | null;
}>;

const refKey = (ref: CardRef) => `${ref.packNumber}:${ref.slot}`;
const typeLineOf = (printing: PrintingCard) => printing.faces[0]?.typeLine ?? "";

/** The choices a player can make about one card, from what's face up in front of them. */
function Choices(props: {
  card: PackCardView;
  others: readonly PackCardView[];
  context: ChoiceContext;
  choices: PickChoices;
  onChange: (choices: PickChoices) => void;
}) {
  const { card, context, choices } = props;
  const { options } = context;
  const ability = abilityOf(card.printing.name)?.ability;
  const isCreature = isCreatureLine(typeLineOf(card.printing));
  const noters = options.noteWith.filter((noter) => !noter.creaturesOnly || isCreature);
  const set = (change: PickChoices) => props.onChange({ ...choices, ...change });
  const rows: React.ReactNode[] = [];

  if (options.wholePack && context.turn === null) {
    rows.push(
      <label key="agent" className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={choices.wholePack ?? false}
          onChange={(event) => set({ wholePack: event.target.checked })}
        />
        Agent of Acquisitions: take the whole pack, then draft nothing more this round
      </label>,
    );
  }
  const extras = [
    [
      "librarians",
      options.librarians,
      "Cogwork Librarian: draft another card from this pack (the Librarian goes into it)",
    ],
    [
      "operatives",
      options.operatives,
      "Leovold's Operative: draft another card, then skip your next pack",
    ],
  ] as const;
  for (const [kind, count, label] of extras) {
    if (count === 0 || choices.wholePack || context.turn?.wholePack) continue;
    rows.push(
      <label key={kind} className="flex flex-wrap items-center gap-2">
        <Select
          controlSize="sm"
          value={choices[kind] ?? 0}
          onChange={(event) => set({ [kind]: Number(event.target.value) })}
        >
          {Array.from({ length: count + 1 }, (_, n) => (
            <option key={n} value={n}>
              {n === 0 ? "don't use" : `use ${n}`}
            </option>
          ))}
        </Select>
        {label}
      </label>,
    );
  }
  if (options.remove.faceDown || options.remove.faceUp) {
    rows.push(
      <label key="remove" className="flex flex-wrap items-center gap-2">
        <Select
          controlSize="sm"
          value={choices.remove ?? ""}
          onChange={(event) => {
            const value = event.target.value;
            set({ remove: value === "faceDown" || value === "faceUp" ? value : undefined });
          }}
        >
          <option value="">keep it</option>
          {options.remove.faceDown && (
            <option value="faceDown">remove it face down (Cogwork Grinder)</option>
          )}
          {options.remove.faceUp && (
            <option value="faceUp">remove it face up (Animus of Predation)</option>
          )}
        </Select>
        Removed cards stay in your collection, but not in this draft&apos;s pool.
      </label>,
    );
  }
  for (const noter of noters) {
    const key = refKey(noter.ref);
    const checked = (choices.noteWith ?? []).some((each) => refKey(each) === key);
    rows.push(
      <label key={`note-${key}`} className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) =>
            set({
              noteWith: event.target.checked
                ? [...(choices.noteWith ?? []), noter.ref]
                : (choices.noteWith ?? []).filter((each) => refKey(each) !== key),
            })
          }
        />
        Reveal it and note its {noter.what === "name" ? "name" : "creature types"} with{" "}
        {context.cardNames[key] ?? "your face-up card"} (which turns face down)
      </label>,
    );
  }
  if (ability?.kind === "guess") {
    rows.push(
      <label key="guess" className="flex flex-wrap items-center gap-2">
        Spire Phantasm: guess the next card drafted from this pack
        <Input
          controlSize="sm"
          list="phantasm-guesses"
          value={choices.guess ?? ""}
          onChange={(event) => set({ guess: event.target.value })}
          placeholder="a card name"
        />
        <datalist id="phantasm-guesses">
          {props.others.map((other) => (
            <option key={other.slot} value={other.printing.name} />
          ))}
        </datalist>
      </label>,
    );
  }
  if (ability?.kind === "addPack" && context.lore !== null) {
    const value =
      choices.addPack === undefined
        ? ""
        : choices.addPack.source === "inventory"
          ? `inventory|${choices.addPack.itemId}`
          : `buy|${choices.addPack.setCode}|${choices.addPack.boosterType}`;
    rows.push(
      <label key="lore" className="flex flex-wrap items-center gap-2">
        Lore Seeker: add a booster pack (your next pick comes from it)
        <Select
          controlSize="sm"
          value={value}
          onChange={(event) => {
            const [source, first, second] = event.target.value.split("|");
            if (source === "inventory") {
              set({ addPack: { source: "inventory", itemId: Number(first) } });
            } else if (source === "buy") {
              set({ addPack: { source: "buy", setCode: first, boosterType: second } });
            } else {
              set({ addPack: undefined });
            }
          }}
        >
          <option value="">no pack</option>
          {context.lore.inventory.length > 0 && (
            <optgroup label="From your inventory">
              {context.lore.inventory.map((item) => (
                <option key={item.itemId} value={`inventory|${item.itemId}`}>
                  {item.name}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Buy one now">
            {context.lore.buy.map((option) => (
              <option
                key={`${option.setCode}|${option.boosterType}`}
                value={`buy|${option.setCode}|${option.boosterType}`}
              >
                {option.label}
              </option>
            ))}
          </optgroup>
        </Select>
      </label>,
    );
  }
  if (options.lastCardTo.length > 1) {
    rows.push(
      <label key="dredger" className="flex flex-wrap items-center gap-2">
        If this leaves one card, pass it to
        <Select
          controlSize="sm"
          value={choices.lastCardTo ?? options.lastCardTo[0]}
          onChange={(event) => set({ lastCardTo: Number(event.target.value) })}
        >
          {options.lastCardTo.map((seat) => (
            <option key={seat} value={seat}>
              {context.seatNames[seat] ?? `seat ${seat + 1}`}
            </option>
          ))}
        </Select>
        (Canal Dredger)
      </label>,
    );
  }
  if (rows.length === 0) return null;
  return (
    <fieldset className="flex flex-col gap-1.5 rounded-md border border-violet-300 p-3 text-sm dark:border-violet-800">
      <legend className="px-1 text-xs font-semibold text-violet-700 dark:text-violet-300">
        Draft abilities
      </legend>
      {rows}
    </fieldset>
  );
}

function CardButton(props: {
  card: PackCardView;
  selected: boolean;
  onSelect: () => void;
  onPick: () => void;
}) {
  const { card } = props;
  return (
    <button
      type="button"
      onClick={props.onSelect}
      onDoubleClick={props.onPick}
      aria-pressed={props.selected}
      aria-label={`${card.printing.name}${card.finish === "nonfoil" ? "" : ` (${card.finish})`}`}
      className={`relative block w-full rounded-[4.5%] transition ${
        props.selected
          ? "ring-offset-background ring-4 ring-sky-500 ring-offset-2"
          : "hover:-translate-y-0.5"
      }`}
    >
      {card.printing.hasImage ? (
        <CardImage
          src={`/api/images/${card.printing.id}/normal/front`}
          decorative
          width={146}
          height={204}
          className={CARD_FACE}
        />
      ) : (
        <span className={`${CARD_FACE} flex items-center justify-center p-2 text-center text-xs`}>
          {card.printing.name}
        </span>
      )}
      {card.finish !== "nonfoil" && (
        <span
          aria-hidden
          className={`${FOIL_SHEEN} pointer-events-none absolute inset-0 rounded-[4.5%]`}
        />
      )}
    </button>
  );
}

export function PickGrid(props: {
  draftId: number;
  packNumber: number;
  cards: readonly PackCardView[];
  context: ChoiceContext;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [choices, setChoices] = useState<PickChoices>({});
  const [error, setError] = useState<string | null>(null);
  const [isPicking, startPicking] = useTransition();
  const chosen = props.cards.find((card) => card.slot === selected) ?? null;

  function select(slot: number | null) {
    setSelected(slot);
    setChoices({});
  }

  function pick(slot: number, withChoices: PickChoices) {
    if (isPicking) return;
    setError(null);
    startPicking(async () => {
      const result = await pickAction({
        draftId: props.draftId,
        packNumber: props.packNumber,
        slot,
        choices: withChoices,
      });
      if (result.error !== null) setError(result.error);
      select(null);
    });
  }

  const turn = props.context.turn;
  return (
    <div className="flex flex-col gap-3">
      {turn !== null && (
        <p className="rounded-md bg-violet-50 px-3 py-2 text-sm text-violet-900 dark:bg-violet-950 dark:text-violet-100">
          {turn.wholePack
            ? "You're taking this whole pack: draft every card, in the order you like."
            : `Draft ${turn.extraCards} more card${turn.extraCards === 1 ? "" : "s"} from this pack.`}
        </p>
      )}
      <div className="flex min-h-10 flex-wrap items-center gap-3">
        {chosen === null ? (
          <p className="text-muted text-sm">
            Tap a card to look at it, then pick it. Double-click picks straight away.
          </p>
        ) : (
          <>
            <Button
              type="button"
              size="xl"
              onClick={() => pick(chosen.slot, choices)}
              disabled={isPicking}
            >
              {isPicking ? "Picking…" : `Pick ${chosen.printing.name}`}
            </Button>
            <button type="button" onClick={() => select(null)} className="text-sm underline">
              Cancel
            </button>
          </>
        )}
        {error !== null && <span className="text-danger-text text-sm">{error}</span>}
      </div>

      {chosen !== null && (
        <Choices
          card={chosen}
          others={props.cards.filter((card) => card.slot !== chosen.slot)}
          context={props.context}
          choices={choices}
          onChange={setChoices}
        />
      )}

      {/* On phones a card that opens over the grid would hide it: show the chosen one here. */}
      {chosen !== null && chosen.printing.hasImage && (
        <CardImage
          src={`/api/images/${chosen.printing.id}/normal/front`}
          alt={chosen.printing.name}
          width={488}
          height={680}
          className="mx-auto aspect-[488/680] w-3/4 max-w-xs rounded-[4.5%] sm:hidden"
        />
      )}

      <ul
        className={`grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-7 ${isPicking ? "opacity-60" : ""}`}
        aria-label="Your pack"
      >
        {props.cards.map((card, index) => (
          <li key={card.slot} className="relative">
            <CardButton
              card={card}
              selected={card.slot === selected}
              onSelect={() => select(card.slot === selected ? null : card.slot)}
              onPick={() => pick(card.slot, {})}
            />
            {card.slot === selected && (
              <div className="hidden sm:block">
                <EnlargedCard
                  printing={card.printing}
                  align={index % 7 === 0 ? "left" : index % 7 === 6 ? "right" : "center"}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Archdemon of Paliano: you can't look at the pack, so you draw a card at random. */
export function RandomPick(props: { draftId: number; packNumber: number; count: number }) {
  const [error, setError] = useState<string | null>(null);
  const [isPicking, startPicking] = useTransition();
  return (
    <div className={`${DASHED_BOX} border-red-400 dark:border-red-800`}>
      <p>
        Your Archdemon of Paliano is face up: you can&apos;t look at this pack ({props.count}{" "}
        cards). You draft at random, and see the card once it&apos;s yours.
      </p>
      <Button
        type="button"
        size="xl"
        disabled={isPicking}
        onClick={() =>
          startPicking(async () => {
            const result = await pickAction({
              draftId: props.draftId,
              packNumber: props.packNumber,
              slot: "random",
              choices: {},
            });
            setError(result.error);
          })
        }
      >
        {isPicking ? "Drawing…" : "Draft at random"}
      </Button>
      {error !== null && <span className="text-danger-text">{error}</span>}
    </div>
  );
}

/** The card you drew at random, with the choices you can make about it now that you see it. */
export function AwaitingCard(props: {
  draftId: number;
  card: PackCardView;
  context: ChoiceContext;
}) {
  const [choices, setChoices] = useState<PickChoices>({});
  const [error, setError] = useState<string | null>(null);
  const [isDeciding, startDeciding] = useTransition();
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">You drew {props.card.printing.name}.</p>
      <div className="w-40">
        <CardButton
          card={props.card}
          selected={false}
          onSelect={() => undefined}
          onPick={() => undefined}
        />
      </div>
      <Choices
        card={props.card}
        others={[]}
        context={props.context}
        choices={choices}
        onChange={setChoices}
      />
      <div className="flex items-center gap-3">
        <Button
          type="button"
          size="xl"
          disabled={isDeciding}
          onClick={() =>
            startDeciding(async () => {
              const result = await decideAction({ draftId: props.draftId, choices });
              setError(result.error);
            })
          }
        >
          {isDeciding ? "Saving…" : "Done"}
        </Button>
        {error !== null && <span className="text-danger-text text-sm">{error}</span>}
      </div>
    </div>
  );
}
