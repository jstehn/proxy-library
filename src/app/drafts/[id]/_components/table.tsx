import type { DraftSeen, DraftView } from "@/modules/drafts";
import { pickForAwayAction } from "../../actions";
import { type Names, SeatAbilities } from "./conspiracy";
import { Countdown } from "./countdown";
import { BotMark, Presence } from "./seat-marks";

/** Everyone at the table, in seat order, with how many packs wait for them and what's public. */
export function Table(props: {
  view: DraftView;
  seen: DraftSeen;
  names: Names;
  serverNow: string;
}) {
  const { view } = props;
  return (
    <section aria-label="The table" className="flex flex-col gap-2">
      <ol className="flex flex-wrap gap-2">
        {view.seats.map((seat) => (
          <li
            key={seat.seatNumber}
            className={`flex max-w-64 min-w-36 flex-col gap-0.5 rounded-md border px-3 py-2 text-sm ${
              seat.isYou
                ? "border-sky-400 bg-sky-50 dark:border-sky-700 dark:bg-sky-950"
                : "border-border-subtle"
            }`}
          >
            <span className="flex items-center gap-1.5 font-medium">
              {seat.botNumber === null ? <Presence away={seat.away} /> : <BotMark />}
              {seat.name}
              {seat.isYou && <span className="text-muted text-xs font-normal">you</span>}
            </span>
            <span className="text-muted text-xs">
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
            <SeatAbilities
              seat={props.seen.seats.find((each) => each.seatNumber === seat.seatNumber)}
              names={props.names}
            />
            {view.isHost && !seat.isYou && seat.away && seat.botNumber === null && (
              <form action={pickForAwayAction}>
                <input type="hidden" name="draftId" value={view.id} />
                <input type="hidden" name="seatNumber" value={seat.seatNumber} />
                <button type="submit" className="text-xs underline">
                  Act for them
                </button>
              </form>
            )}
          </li>
        ))}
      </ol>
      <p className="text-muted text-xs">
        {view.passDirection === "left"
          ? "This round, packs move along the list (→), from the last player back to the first."
          : "This round, packs move back along the list (←), from the first player to the last."}{" "}
        A grey dot means the player&apos;s page isn&apos;t open. Face-up cards and anything noted
        are public; purple text is face up.
      </p>
    </section>
  );
}
