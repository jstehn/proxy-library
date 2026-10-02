import type { PrintingCard } from "@/modules/catalog";
import {
  guessedRight,
  type CardRef,
  type DealSeen,
  type Note,
  type PickOptions,
  type Reveal,
  type SeatSeen,
  type SeenCard,
  type YouSeen,
} from "@/modules/drafts";
import { SubmitButton } from "@/ui/form";
import { LocalTime } from "@/ui/local-time";
import {
  chooseColorAction,
  dealAction,
  endDealsAction,
  informantAction,
  sneakAction,
} from "../actions";

// The parts of the draft page that Conspiracy's draft-matters cards add (design doc 18): what
// everyone may see at each seat, the reveal log, prompts, any-time actions and Deal Broker.

export type Names = Readonly<{
  seat: (seatNumber: number | null) => string;
  printing: (printingId: string) => string;
  printings: ReadonlyMap<string, PrintingCard>;
}>;

const COLOR_NAMES: Readonly<Record<string, string>> = {
  W: "white",
  U: "blue",
  B: "black",
  R: "red",
  G: "green",
};

const refValue = (ref: CardRef) => `${ref.packNumber}:${ref.slot}`;

/** What a note says, in plain words. */
export function noteText(note: Note, names: Names): string {
  switch (note.kind) {
    case "count":
      return `noted ${note.value}`;
    case "passedBy":
      return note.seat === null ? "noted nobody (opened it)" : `noted ${names.seat(note.seat)}`;
    case "colors": {
      const chosen = note.colors.map((color) => COLOR_NAMES[color]).join(", ");
      const next = note.choosers[note.colors.length];
      return next === undefined
        ? `colors: ${chosen}`
        : `colors: ${chosen || "none yet"} (${names.seat(next)} chooses next)`;
    }
    case "name":
      return `noted ${note.name}`;
    case "types":
      return `noted ${note.types.join(" ") || "no creature types"}`;
    case "guess":
      if (note.actual === null) return `guessed ${note.guess ?? "nothing"}`;
      return `guessed ${note.guess ?? "nothing"}: it was ${note.actual} ${guessedRight(note) ? "✓" : "✗"}`;
    case "randomDrafted":
      return `${note.count} of 3 drafted at random`;
  }
}

/** One card's name with its notes. */
function CardWithNotes(props: { card: SeenCard; names: Names }) {
  return (
    <li className="leading-snug">
      {props.names.printing(props.card.printingId)}
      {props.card.notes.length > 0 && (
        <span className="text-zinc-500">
          {" "}
          ({props.card.notes.map((note) => noteText(note, props.names)).join("; ")})
        </span>
      )}
    </li>
  );
}

/** What everyone may see at a seat: face-up cards, noted information, cards removed face up. */
export function SeatAbilities(props: { seat: SeatSeen | undefined; names: Names }) {
  const seat = props.seat;
  if (seat === undefined) return null;
  const noted = seat.noted.filter((card) => card.pick?.state !== "faceUp");
  if (seat.faceUp.length + noted.length + seat.removedFaceUp.length === 0 && !seat.owesColor) {
    return null;
  }
  return (
    <div className="flex flex-col gap-0.5 text-xs">
      {seat.owesColor && (
        <span className="text-amber-700 dark:text-amber-300">choosing a color…</span>
      )}
      {seat.faceUp.length > 0 && (
        <ul className="text-violet-700 dark:text-violet-300" aria-label="Face up">
          {seat.faceUp.map((card) => (
            <CardWithNotes key={refValue(card.ref)} card={card} names={props.names} />
          ))}
        </ul>
      )}
      {noted.length > 0 && (
        <ul aria-label="Noted">
          {noted.map((card) => (
            <CardWithNotes key={refValue(card.ref)} card={card} names={props.names} />
          ))}
        </ul>
      )}
      {seat.removedFaceUp.length > 0 && (
        <span className="text-zinc-500">
          removed:{" "}
          {seat.removedFaceUp.map((card) => props.names.printing(card.printingId)).join(", ")}
        </span>
      )}
    </div>
  );
}

const REVEAL_TEXT: Readonly<Record<Reveal["kind"], string>> = {
  revealed: "revealed",
  removed: "removed from the draft",
  guessed: "drafted (Spire Phantasm's guess)",
  spied: "drafted (your Cogwork Spy saw it)",
  informed: "drafted (your Illusionary Informant saw it)",
  peeked: "pack (Whispergear Sneak)",
  passedOn: "passed on without drafting:",
  dealt: "offered in a deal:",
};

/** The newest reveals: to everyone, or only to you (marked). */
export function RevealLog(props: { reveals: readonly Reveal[]; names: Names; you: number | null }) {
  const latest = [...props.reveals].reverse().slice(0, 12);
  if (latest.length === 0) return null;
  return (
    <section aria-label="Revealed" className="flex flex-col gap-1">
      <h2 className="text-sm font-medium">Revealed during the draft</h2>
      <ul className="flex flex-col gap-0.5 text-xs">
        {latest.map((reveal, index) => (
          <li
            key={index}
            className={reveal.audience === null ? "" : "text-sky-700 dark:text-sky-300"}
          >
            <LocalTime iso={reveal.at.toISOString()} withTime />{" "}
            {reveal.audience !== null && <strong>only you: </strong>}
            {props.names.seat(reveal.seat)} {REVEAL_TEXT[reveal.kind]}{" "}
            {reveal.cards.map((card) => props.names.printing(card.printingId)).join(", ") ||
              "nothing"}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Paliano, the High City / Regicide: a color you owe, before your next pick. */
export function ColorPrompt(props: {
  draftId: number;
  prompt: NonNullable<YouSeen["colorPrompt"]>;
  names: Names;
}) {
  return (
    <section className="flex flex-col gap-2 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950">
      <p>
        Choose a color for {props.names.printing(props.prompt.card.printingId)}
        {props.prompt.chosen.length > 0 &&
          ` (already chosen: ${props.prompt.chosen.map((color) => COLOR_NAMES[color]).join(", ")})`}
        . You can&apos;t draft again until you do.
      </p>
      <div className="flex flex-wrap gap-2">
        {props.prompt.open.map((color) => (
          <form key={color} action={chooseColorAction}>
            <input type="hidden" name="draftId" value={props.draftId} />
            <input type="hidden" name="color" value={color} />
            <SubmitButton tone="secondary">{COLOR_NAMES[color]}</SubmitButton>
          </form>
        ))}
      </div>
    </section>
  );
}

/** Whispergear Sneak and Illusionary Informant: usable any time while face up. */
export function AnyTimeActions(props: {
  draftId: number;
  options: PickOptions;
  packLabel: (packNumber: number) => string;
  names: Names;
}) {
  const { sneak, informant } = props.options;
  if (sneak === null && informant === null) return null;
  const field =
    "rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900";
  return (
    <section className="flex flex-col gap-2 rounded-md border border-violet-300 p-3 text-sm dark:border-violet-800">
      <h2 className="text-xs font-semibold text-violet-700 dark:text-violet-300">
        Any time during the draft
      </h2>
      {sneak !== null && sneak.packs.length > 0 && (
        <form action={sneakAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="draftId" value={props.draftId} />
          <input type="hidden" name="card" value={refValue(sneak.card)} />
          Whispergear Sneak: look at
          <select name="packNumber" className={field}>
            {sneak.packs.map((packNumber) => (
              <option key={packNumber} value={packNumber}>
                {props.packLabel(packNumber)}
              </option>
            ))}
          </select>
          <SubmitButton tone="secondary">Turn it face down and look</SubmitButton>
        </form>
      )}
      {informant !== null && (
        <form action={informantAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="draftId" value={props.draftId} />
          <input type="hidden" name="card" value={refValue(informant.card)} />
          Illusionary Informant: see the next card drafted by
          <select name="targetSeat" className={field}>
            {informant.targets.map((seat) => (
              <option key={seat} value={seat}>
                {props.names.seat(seat)}
              </option>
            ))}
          </select>
          <SubmitButton tone="secondary">Turn it face down</SubmitButton>
        </form>
      )}
    </section>
  );
}

/** Deal Broker, right after the draft (design doc 18). */
export function Dealing(props: {
  draftId: number;
  deal: DealSeen;
  you: YouSeen | null;
  isHost: boolean;
  names: Names;
}) {
  const { deal, you, names } = props;
  const mine = you?.seatNumber;
  const field =
    "rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900";
  const cardOptions = (you?.pool ?? []).map((card) => (
    <option key={refValue(card.ref)} value={refValue(card.ref)}>
      {names.printing(card.printingId)}
    </option>
  ));
  const hidden = (
    <>
      <input type="hidden" name="draftId" value={props.draftId} />
    </>
  );
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
      <h2 className="font-medium">
        Deal Broker: {names.seat(deal.brokerSeat)} may trade one card from their pool
      </h2>
      {deal.revealed !== null && <p>They offer {names.printing(deal.revealed.printingId)}.</p>}
      {deal.stage === "reveal" && mine === deal.brokerSeat && (
        <form action={dealAction} className="flex flex-wrap items-center gap-2">
          {hidden}
          <input type="hidden" name="step" value="reveal" />
          <select name="card" className={field}>
            <option value="none">make no deal</option>
            {cardOptions}
          </select>
          <SubmitButton>Reveal it</SubmitButton>
        </form>
      )}
      {deal.stage === "offers" && mine !== undefined && deal.waitingFor.includes(mine) && (
        <form action={dealAction} className="flex flex-wrap items-center gap-2">
          {hidden}
          <input type="hidden" name="step" value="offer" />
          Offer in exchange:
          <select name="card" className={field}>
            <option value="none">nothing</option>
            {cardOptions}
          </select>
          <SubmitButton>Make my offer</SubmitButton>
        </form>
      )}
      {deal.offers.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {deal.offers.map((offer) => (
            <li key={offer.seat}>
              {names.seat(offer.seat)} offers{" "}
              {offer.card === null ? "nothing" : names.printing(offer.card.printingId)}
            </li>
          ))}
        </ul>
      )}
      {deal.stage === "accept" && mine === deal.brokerSeat && (
        <form action={dealAction} className="flex flex-wrap items-center gap-2">
          {hidden}
          <input type="hidden" name="step" value="accept" />
          <select name="offerSeat" className={field}>
            <option value="none">accept none</option>
            {deal.offers
              .filter((offer) => offer.card !== null)
              .map((offer) => (
                <option key={offer.seat} value={offer.seat}>
                  {names.seat(offer.seat)}&apos;s{" "}
                  {offer.card === null ? "" : names.printing(offer.card.printingId)}
                </option>
              ))}
          </select>
          <SubmitButton>Decide</SubmitButton>
        </form>
      )}
      <p className="text-xs text-zinc-500">
        Waiting for {deal.waitingFor.map((seat) => names.seat(seat)).join(", ") || "nobody"}.
        {deal.deadline !== null && (
          <>
            {" "}
            Ends by itself at <LocalTime iso={deal.deadline.toISOString()} withTime />.
          </>
        )}
      </p>
      {props.isHost && (
        <form action={endDealsAction}>
          {hidden}
          <button type="submit" className="text-xs underline">
            End the deals now (pools stay as they are)
          </button>
        </form>
      )}
    </section>
  );
}
