import Link from "next/link";
import { notFound } from "next/navigation";
import { printingCards, type PrintingCard } from "@/modules/catalog";
import { draftView, type DraftView, type PickedCard, type SeatView } from "@/modules/drafts";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { Cents } from "@/shared/kernel";
import { Alert, SubmitButton } from "@/ui/form";
import { KeyruneStylesheet, SetSymbol } from "@/ui/set-symbol";
import { CardTile } from "../../_components/card-tile";
import {
  addBotAction,
  joinDraftAction,
  leaveDraftAction,
  makeDraftDeckAction,
  pickForAwayAction,
  removeBotAction,
  startDraftAction,
} from "../actions";
import { boosterLabel, timerLabel } from "../labels";
import { Countdown } from "./countdown";
import { LiveUpdates } from "./live-updates";
import { PickGrid } from "./pick-grid";
import { COLUMN_LABELS, curveOf, poolColumns, stacksOf } from "./pool";

// One draft (design doc 17): the lobby, the pick screen with the table around it, and the
// finished pool. Everything shown comes from `draftView`, which only ever returns this player's
// own cards (rule 13). LiveUpdates reloads it whenever the draft changes.

const STATUS_TEXT: Record<DraftView["status"], string> = {
  lobby: "Waiting for players",
  drafting: "Drafting",
  finished: "Finished",
  cancelled: "Cancelled",
};

export default async function DraftPage(props: PageProps<"/drafts/[id]">) {
  const actor = await requireActor();
  const draftId = Number((await props.params).id);
  if (!Number.isSafeInteger(draftId) || draftId <= 0) notFound();
  const { db, clock } = getContainer();
  const now = clock.now();
  const view = await draftView(db, draftId, actor.userId, now);
  if (view === null) notFound();
  const error = (await props.searchParams).error;

  const ids = [
    ...(view.you?.pack?.cards.map((card) => card.printingId) ?? []),
    ...(view.you?.picks.map((pick) => pick.printingId) ?? []),
  ];
  const printings = await printingCards(db, ids);
  const isLive = view.status === "lobby" || view.status === "drafting";

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <KeyruneStylesheet />
      <header className="flex flex-col gap-1">
        <Link href="/drafts" className="text-sm underline">
          All drafts
        </Link>
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
          <SetSymbol keyruneCode={view.keyruneCode} />
          {view.setName} draft
          {isLive && <LiveUpdates draftId={view.id} version={view.version} />}
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {STATUS_TEXT[view.status]} · {boosterLabel(view.boosterType)} · hosted by {view.hostName}{" "}
          · {Cents.format(view.entryFee)} to enter · {timerLabel(view.secondsPerPick)}
        </p>
      </header>
      {typeof error === "string" && <Alert tone="error">{error}</Alert>}

      {view.status === "lobby" && <Lobby view={view} canAddBots={actor.isAdmin && view.isHost} />}
      {view.status === "drafting" && (
        <Drafting view={view} printings={printings} serverNow={now.toISOString()} />
      )}
      {view.status === "finished" && <Finished view={view} printings={printings} />}
      {view.status === "cancelled" && (
        <p className="text-sm text-zinc-500">
          The host closed this lobby before it started. Everyone got their entry fee back.
        </p>
      )}
    </main>
  );
}

function Lobby(props: { view: DraftView; canAddBots: boolean }) {
  const { view } = props;
  const isSeated = view.you !== null;
  const hidden = (name: string, value: number) => <input type="hidden" name={name} value={value} />;
  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-medium">
        Players ({view.seats.length}/{view.maxSeats})
      </h2>
      <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
        {view.seats.map((seat) => (
          <li key={seat.seatNumber} className="flex items-center gap-2 py-2 text-sm">
            {seat.botNumber === null ? <Presence away={seat.away} /> : <BotMark />}
            <span className="font-medium">{seat.name}</span>
            {seat.isHost && <span className="text-xs text-zinc-500">host</span>}
            {seat.isYou && <span className="text-xs text-zinc-500">you</span>}
            {seat.botNumber !== null && (
              <span className="text-xs text-zinc-500">its picks go to {view.hostName}</span>
            )}
            {seat.botNumber !== null && view.isHost && (
              <form action={removeBotAction} className="ml-auto">
                {hidden("draftId", view.id)}
                {hidden("botNumber", seat.botNumber)}
                <button type="submit" className="text-xs underline">
                  Remove (refund)
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-2">
        {!isSeated && view.seats.length < view.maxSeats && (
          <form action={joinDraftAction}>
            {hidden("draftId", view.id)}
            <SubmitButton pendingText="Joining…">
              Join for {Cents.format(view.entryFee)}
            </SubmitButton>
          </form>
        )}
        {props.canAddBots && view.seats.length < view.maxSeats && (
          <form action={addBotAction}>
            {hidden("draftId", view.id)}
            <SubmitButton tone="secondary" pendingText="Adding…">
              Add a bot ({Cents.format(view.entryFee)})
            </SubmitButton>
          </form>
        )}
        {view.isHost && (
          <form action={startDraftAction}>
            {hidden("draftId", view.id)}
            <SubmitButton pendingText="Opening packs…">
              {view.seats.length < 2 ? "Start (needs another player)" : "Start the draft"}
            </SubmitButton>
          </form>
        )}
        {isSeated && (
          <form action={leaveDraftAction}>
            {hidden("draftId", view.id)}
            <SubmitButton tone="secondary" pendingText="Leaving…">
              {view.isHost ? "Close the lobby (refund everyone)" : "Leave (get your fee back)"}
            </SubmitButton>
          </form>
        )}
      </div>
      <p className="text-xs text-zinc-500">
        Everyone opens {view.packsPerPlayer} packs, one per round. Packs go left, then right, then
        left. Basic lands are taken out of the packs and dealt out evenly to the players instead.
        Keep this page open: when the host starts, your first pack appears here.
      </p>
    </section>
  );
}

/** Marks a bot's seat where a person's shows here or away. */
function BotMark() {
  return (
    <span
      title="bot"
      aria-label="bot"
      className="inline-block h-2 w-2 shrink-0 rounded-sm bg-violet-500"
    />
  );
}

function Presence(props: { away: boolean }) {
  return (
    <span
      title={props.away ? "away" : "here"}
      aria-label={props.away ? "away" : "here"}
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${props.away ? "bg-zinc-400" : "bg-green-500"}`}
    />
  );
}

function Drafting(props: {
  view: DraftView;
  printings: Map<string, PrintingCard>;
  serverNow: string;
}) {
  const { view, printings } = props;
  const you = view.you;
  const mySeat = view.seats.find((seat) => seat.isYou);
  const arrow = view.passDirection === "left" ? "→" : "←";

  return (
    <div className="flex flex-col gap-6">
      <Table view={view} serverNow={props.serverNow} />

      {you === null || mySeat === undefined ? (
        <p className="text-sm text-zinc-500">
          You&apos;re watching. Only the players see their packs.
        </p>
      ) : (
        <section className="flex flex-col gap-3">
          <h2 className="flex flex-wrap items-baseline gap-x-3 font-medium">
            <span>
              Round {view.round} of {view.packsPerPlayer}, pick {you.picks.length + 1}
            </span>
            <span className="text-sm font-normal text-zinc-500">
              passing {view.passDirection} {arrow}
            </span>
            {you.pack !== null && mySeat.deadline !== null && (
              <Countdown
                key={`${mySeat.deadline}/${props.serverNow}`}
                deadline={mySeat.deadline}
                serverNow={props.serverNow}
                className="text-lg"
              />
            )}
          </h2>
          {you.pack === null ? (
            <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
              Waiting for {neighbourName(view, mySeat)} to pass you a pack…
            </p>
          ) : (
            <PickGrid
              draftId={view.id}
              packNumber={you.pack.packNumber}
              cards={you.pack.cards.flatMap((card) => {
                const printing = printings.get(card.printingId);
                return printing === undefined
                  ? []
                  : [{ slot: card.slot, finish: card.finish, printing }];
              })}
            />
          )}
          {mySeat.waiting > 1 && (
            <p className="text-xs text-zinc-500">
              {mySeat.waiting - 1} more pack{mySeat.waiting > 2 ? "s" : ""} waiting behind this one.
            </p>
          )}
        </section>
      )}

      {you !== null && <Picks picks={you.picks} printings={printings} />}
      {you !== null && you.basicsReceived.length > 0 && (
        <p className="text-xs text-zinc-500">
          Basic lands aren&apos;t drafted: {basicCount(you)} from the packs were dealt to you and
          are in your collection. Your draft deck will use your own basics, topped up if you&apos;re
          short.
        </p>
      )}
    </div>
  );
}

/** Who passes to this seat this round. */
function neighbourName(view: DraftView, seat: SeatView): string {
  const count = view.seats.length;
  const step = view.passDirection === "left" ? -1 : 1;
  const from = (seat.seatNumber + step + count) % count;
  return view.seats.find((each) => each.seatNumber === from)?.name ?? "the next player";
}

/** Everyone at the table, in seat order, with how many packs wait for them. */
function Table(props: { view: DraftView; serverNow: string }) {
  const { view } = props;
  return (
    <section aria-label="The table" className="flex flex-col gap-2">
      <ol className="flex flex-wrap gap-2">
        {view.seats.map((seat) => (
          <li
            key={seat.seatNumber}
            className={`flex min-w-36 flex-col gap-0.5 rounded-md border px-3 py-2 text-sm ${
              seat.isYou
                ? "border-sky-400 bg-sky-50 dark:border-sky-700 dark:bg-sky-950"
                : "border-zinc-200 dark:border-zinc-800"
            }`}
          >
            <span className="flex items-center gap-1.5 font-medium">
              {seat.botNumber === null ? <Presence away={seat.away} /> : <BotMark />}
              {seat.name}
              {seat.isYou && <span className="text-xs font-normal text-zinc-500">you</span>}
            </span>
            <span className="text-xs text-zinc-500">
              {seat.picks} picked ·{" "}
              {seat.waiting === 0
                ? "waiting"
                : `${seat.waiting} pack${seat.waiting === 1 ? "" : "s"} to pick from`}
            </span>
            {seat.waiting > 0 && seat.deadline !== null && !seat.isYou && (
              <Countdown
                key={`${seat.deadline}/${props.serverNow}`}
                deadline={seat.deadline}
                serverNow={props.serverNow}
                className="text-xs"
              />
            )}
            {view.isHost && !seat.isYou && seat.away && seat.waiting > 0 && (
              <form action={pickForAwayAction}>
                <input type="hidden" name="draftId" value={view.id} />
                <input type="hidden" name="seatNumber" value={seat.seatNumber} />
                <button type="submit" className="text-xs underline">
                  Pick for them
                </button>
              </form>
            )}
          </li>
        ))}
      </ol>
      <p className="text-xs text-zinc-500">
        {view.passDirection === "left"
          ? "This round, packs move along the list (→), from the last player back to the first."
          : "This round, packs move back along the list (←), from the first player to the last."}{" "}
        A grey dot means the player&apos;s page isn&apos;t open.
      </p>
    </section>
  );
}

function Picks(props: { picks: readonly PickedCard[]; printings: Map<string, PrintingCard> }) {
  const faceOf = (pick: PickedCard) => props.printings.get(pick.printingId)?.faces[0];
  const columns = poolColumns(props.picks, faceOf);
  const curve = curveOf(props.picks, faceOf);
  if (props.picks.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <h2 className="font-medium">Your picks ({props.picks.length})</h2>
        <Curve counts={curve} />
      </div>
      <div className="flex flex-wrap gap-4">
        {columns.map(({ column, cards }) => (
          <div key={column} className="flex w-36 flex-col gap-1">
            <h3 className="text-xs font-semibold text-zinc-500">
              {COLUMN_LABELS[column]} ({cards.length})
            </h3>
            <ul className="flex flex-col gap-0.5 text-sm">
              {stacksOf(cards, (pick) => `${pick.printingId}/${pick.finish}`).map(
                ({ card: pick, count, all }) => (
                  <li key={pick.pickNumber} className="truncate" title={`Pick ${pick.pickNumber}`}>
                    {count > 1 && <span className="tabular-nums">{count} × </span>}
                    {props.printings.get(pick.printingId)?.name ?? "Unknown card"}
                    {pick.finish !== "nonfoil" && (
                      <span className="text-xs text-sky-600 dark:text-sky-400"> {pick.finish}</span>
                    )}
                    {all.some((each) => each.auto) && (
                      <span className="text-xs text-zinc-500"> (auto)</span>
                    )}
                  </li>
                ),
              )}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

const basicCount = (you: NonNullable<DraftView["you"]>) =>
  you.basicsReceived.reduce((sum, basic) => sum + basic.quantity, 0);

const CURVE_LABELS = ["1", "2", "3", "4", "5", "6+"];

/** A small bar chart of how many spells cost 1, 2, … 6 or more. */
function Curve(props: { counts: readonly number[] }) {
  const most = Math.max(1, ...props.counts);
  return (
    <figure className="flex items-end gap-1" aria-label="Mana curve of your spells">
      {props.counts.map((count, index) => (
        <span
          key={index}
          className="flex w-6 flex-col items-center gap-0.5 text-[10px] text-zinc-500"
        >
          <span className="tabular-nums">{count}</span>
          <span
            aria-hidden
            className="w-4 rounded-sm bg-zinc-400 dark:bg-zinc-500"
            style={{ height: `${Math.max(2, (count / most) * 28)}px` }}
          />
          <span>{CURVE_LABELS[index]}</span>
        </span>
      ))}
    </figure>
  );
}

function Finished(props: { view: DraftView; printings: Map<string, PrintingCard> }) {
  const { view, printings } = props;
  const you = view.you;
  return (
    <div className="flex flex-col gap-6">
      {you === null ? (
        <p className="text-sm text-zinc-500">
          {view.seats.map((seat) => seat.name).join(", ")} drafted this one.
        </p>
      ) : (
        <>
          <section className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <p className="text-sm">
              Your {you.picks.length} cards are in your collection
              {you.basicsReceived.length > 0 &&
                `, with ${basicCount(you)} basic lands dealt from the packs`}
              {you.botPicks > 0 && `, and the ${you.botPicks} cards your bots picked`}.
              {you.deckId !== null
                ? " Your draft deck has a suggested 40-card build to start from."
                : ""}
            </p>
            {you.deckId !== null ? (
              <Link
                href={`/decks/${you.deckId}`}
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
              >
                Open your deck
              </Link>
            ) : (
              <form action={makeDraftDeckAction}>
                <input type="hidden" name="draftId" value={view.id} />
                <SubmitButton>Make a deck from this draft</SubmitButton>
              </form>
            )}
          </section>
          <Picks picks={you.picks} printings={printings} />
          <section className="flex flex-col gap-2">
            <h2 className="font-medium">Your pool in pick order</h2>
            <ul className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-7">
              {you.picks.map((pick) => {
                const printing = printings.get(pick.printingId);
                return printing === undefined ? null : (
                  <CardTile
                    key={pick.pickNumber}
                    printing={printing}
                    isFoil={pick.finish !== "nonfoil"}
                    href={`/cards/${printing.id}`}
                    priceLine={`Pick ${pick.pickNumber}${pick.auto ? " (auto)" : ""}`}
                  />
                );
              })}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
