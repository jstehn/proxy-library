import type { DraftSeen, DraftView, SeatView, SeenCard, YouSeen } from "@/modules/drafts";
import { AnyTimeActions, ColorPrompt, type Names } from "./conspiracy";
import { Countdown } from "./countdown";
import {
  AwaitingCard,
  PickGrid,
  RandomPick,
  type ChoiceContext,
  type LoreSources,
} from "./pick-grid";
import { basicCount, Picks, refKey } from "./pool-view";
import { Table } from "./table";

/** The choices the pick screen may offer, with the names it needs. */
function choiceContext(
  you: YouSeen,
  view: DraftView,
  names: Names,
  lore: LoreSources | null,
): ChoiceContext {
  return {
    options: you.options,
    cardNames: Object.fromEntries(
      you.pile.map((card) => [refKey(card), names.printing(card.printingId)]),
    ),
    seatNames: Object.fromEntries(view.seats.map((seat) => [seat.seatNumber, seat.name])),
    turn: you.turn,
    lore,
  };
}

export function Drafting(props: {
  view: DraftView;
  seen: DraftSeen;
  names: Names;
  serverNow: string;
  lore: LoreSources | null;
}) {
  const { view, seen, names } = props;
  const you = seen.you;
  const mySeat = view.seats.find((seat) => seat.isYou);
  const arrow = view.passDirection === "left" ? "→" : "←";
  const asCard = (card: SeenCard) => {
    const printing = names.printings.get(card.printingId);
    return printing === undefined ? [] : [{ slot: card.ref.slot, finish: card.finish, printing }];
  };

  return (
    <div className="flex flex-col gap-6">
      <Table view={view} seen={seen} names={names} serverNow={props.serverNow} />

      {you === null || mySeat === undefined ? (
        <p className="text-muted text-sm">
          You&apos;re watching. Only the players see their packs.
        </p>
      ) : (
        <section className="flex flex-col gap-3">
          <h2 className="flex flex-wrap items-baseline gap-x-3 font-medium">
            <span>
              Round {view.round} of {view.packsPerPlayer}, pick {you.pile.length + 1}
            </span>
            <span className="text-muted text-sm font-normal">
              passing {view.passDirection} {arrow}
            </span>
            {(you.pack !== null || you.awaiting !== null) && mySeat.deadline !== null && (
              <Countdown
                key={`${mySeat.deadline}/${props.serverNow}`}
                deadline={mySeat.deadline}
                serverNow={props.serverNow}
                className="text-lg"
              />
            )}
          </h2>
          {you.colorPrompt !== null && (
            <ColorPrompt draftId={view.id} prompt={you.colorPrompt} names={names} />
          )}
          {you.skipPacks > 0 && (
            <p className="text-sm text-violet-700 dark:text-violet-300">
              Leovold&apos;s Operative: your next{" "}
              {you.skipPacks === 1 ? "pack goes" : `${you.skipPacks} packs go`} straight on without
              you drafting.
            </p>
          )}
          {you.lockedOut && (
            <p className="text-sm text-violet-700 dark:text-violet-300">
              Agent of Acquisitions: you draft nothing more this round. Packs pass straight through
              you.
            </p>
          )}
          {you.awaiting !== null ? (
            asCard(you.awaiting).map((card) => (
              <AwaitingCard
                key={card.slot}
                draftId={view.id}
                card={card}
                context={choiceContext(you, view, names, props.lore)}
              />
            ))
          ) : you.pack === null ? (
            <p className="text-muted border-line rounded-md border border-dashed p-6 text-center text-sm">
              Waiting for {neighbourName(view, mySeat)} to pass you a pack…
            </p>
          ) : you.pack.cards === null ? (
            <RandomPick draftId={view.id} packNumber={you.pack.packNumber} count={you.pack.count} />
          ) : (
            <PickGrid
              key={`${you.pack.packNumber}/${you.pile.length}`}
              draftId={view.id}
              packNumber={you.pack.packNumber}
              cards={you.pack.cards.flatMap(asCard)}
              context={choiceContext(you, view, names, props.lore)}
            />
          )}
          {mySeat.waiting > 1 && (
            <p className="text-muted text-xs">
              {mySeat.waiting - 1} more pack{mySeat.waiting > 2 ? "s" : ""} waiting behind this one.
            </p>
          )}
          <AnyTimeActions
            draftId={view.id}
            options={you.options}
            names={names}
            packLabel={(packNumber) => packLabel(view, packNumber)}
          />
        </section>
      )}

      {you !== null && <Picks cards={you.pool} printings={names.printings} />}
      {view.you !== null && view.you.basicsReceived.length > 0 && (
        <p className="text-muted text-xs">
          Basic lands aren&apos;t drafted: {basicCount(view.you)} from the packs were dealt to you
          and are in your collection. Your draft deck will use your own basics, topped up if
          you&apos;re short.
        </p>
      )}
    </div>
  );
}

/** "Round 2: Alice's pack": how Whispergear Sneak's choices are named. */
function packLabel(view: DraftView, packNumber: number): string {
  const seats = view.seats.length;
  const round = Math.floor(packNumber / seats) + 1;
  const opener =
    view.seats.find((seat) => seat.seatNumber === packNumber % seats)?.name ?? "someone";
  return packNumber >= seats * view.packsPerPlayer
    ? "an added pack"
    : `round ${round}: ${opener}'s pack`;
}

/** Who passes to this seat this round. */
function neighbourName(view: DraftView, seat: SeatView): string {
  const count = view.seats.length;
  const step = view.passDirection === "left" ? -1 : 1;
  const from = (seat.seatNumber + step + count) % count;
  return view.seats.find((each) => each.seatNumber === from)?.name ?? "the next player";
}
