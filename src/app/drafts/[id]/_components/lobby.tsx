import type { DraftView } from "@/modules/drafts";
import { Cents } from "@/shared/kernel";
import { SubmitButton } from "@/ui/form";
import {
  addBotAction,
  joinDraftAction,
  leaveDraftAction,
  removeBotAction,
  startDraftAction,
} from "../../actions";
import { BotMark, Presence } from "./seat-marks";

/** The lobby: who has joined, and join, add a bot, start or leave. */

export function Lobby(props: { view: DraftView; canAddBots: boolean }) {
  const { view } = props;
  const isSeated = view.you !== null;
  const hidden = (name: string, value: number) => <input type="hidden" name={name} value={value} />;
  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-medium">
        Players ({view.seats.length}/{view.maxSeats})
      </h2>
      <ul className="divide-border-subtle flex flex-col divide-y">
        {view.seats.map((seat) => (
          <li key={seat.seatNumber} className="flex items-center gap-2 py-2 text-sm">
            {seat.botNumber === null ? <Presence away={seat.away} /> : <BotMark />}
            <span className="font-medium">{seat.name}</span>
            {seat.isHost && <span className="text-muted text-xs">host</span>}
            {seat.isYou && <span className="text-muted text-xs">you</span>}
            {seat.botNumber !== null && (
              <span className="text-muted text-xs">its picks go to {view.hostName}</span>
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
      <p className="text-muted text-xs">
        Everyone opens {view.packsPerPlayer} packs, one per round. Packs go left, then right, then
        left. Basic lands are taken out of the packs and dealt out evenly to the players instead.
        Keep this page open: when the host starts, your first pack appears here.
      </p>
    </section>
  );
}
