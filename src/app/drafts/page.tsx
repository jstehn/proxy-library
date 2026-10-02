import Link from "next/link";
import {
  DEFAULT_PICK_SECONDS,
  draftableBoosters,
  draftsOverview,
  MAX_SEATS,
  MIN_SEATS,
  type DraftSummary,
} from "@/modules/drafts";
import { packMsrps } from "@/modules/store";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { Cents } from "@/shared/kernel";
import { Alert, SubmitButton } from "@/ui/form";
import { LocalTime } from "@/ui/local-time";
import { KeyruneStylesheet, SetSymbol } from "@/ui/set-symbol";
import { createDraftAction, joinDraftAction } from "./actions";
import { boosterLabel, timerLabel } from "./labels";

const field =
  "rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const TIMER_CHOICES = [30, 45, 60, 90, 120, 180, 300];
const PACKS_PER_PLAYER = 3;

function StatusBadge(props: { status: DraftSummary["status"] }) {
  const style =
    props.status === "lobby"
      ? "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200"
      : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200";
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${style}`}>
      {props.status === "lobby" ? "waiting for players" : "drafting"}
    </span>
  );
}

function DraftRow(props: { draft: DraftSummary; canJoin: boolean }) {
  const { draft } = props;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
      <SetSymbol keyruneCode={draft.keyruneCode} className="text-xl" />
      <Link href={`/drafts/${draft.id}`} className="font-medium underline">
        {draft.setName}
      </Link>
      <StatusBadge status={draft.status} />
      <span className="text-sm text-zinc-500">
        hosted by {draft.hostName} · {draft.seats}/{draft.maxSeats} players ·{" "}
        {Cents.format(draft.entryFee)} · {timerLabel(draft.secondsPerPick)}
      </span>
      <span className="flex-1" />
      {draft.youAreSeated ? (
        <Link
          href={`/drafts/${draft.id}`}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          {draft.status === "lobby" ? "Open your lobby" : "Back to your draft"}
        </Link>
      ) : (
        props.canJoin &&
        draft.status === "lobby" &&
        draft.seats < draft.maxSeats && (
          <form action={joinDraftAction}>
            <input type="hidden" name="draftId" value={draft.id} />
            <SubmitButton pendingText="Joining…">
              Join for {Cents.format(draft.entryFee)}
            </SubmitButton>
          </form>
        )
      )}
    </li>
  );
}

export default async function DraftsPage(props: PageProps<"/drafts">) {
  const actor = await requireActor();
  const { db } = getContainer();
  const [overview, boosters, prices] = await Promise.all([
    draftsOverview(db, actor.userId),
    draftableBoosters(db),
    packMsrps(db),
  ]);
  const error = (await props.searchParams).error;
  const seatedSomewhere = overview.open.some((draft) => draft.youAreSeated);
  const choices = boosters.flatMap((booster) => {
    const price = prices.get(`${booster.setCode}/${booster.boosterType}`);
    return price === undefined ? [] : [{ ...booster, fee: Cents.of(price * PACKS_PER_PLAYER) }];
  });

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-12">
      <KeyruneStylesheet />
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Drafts</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Draft live with the playgroup: everyone opens a pack, takes a card and passes the rest,
          for three packs. The entry fee is the price of the packs, and every card you take is
          yours. When it ends, your draft deck is waiting in{" "}
          <Link href="/decks?show=drafts" className="underline">
            Decks
          </Link>
          .
        </p>
      </header>
      {typeof error === "string" && <Alert tone="error">{error}</Alert>}

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">Open tables</h2>
        {overview.open.length === 0 ? (
          <p className="text-sm text-zinc-500">No drafts right now. Host one below.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
            {overview.open.map((draft) => (
              <DraftRow key={draft.id} draft={draft} canJoin={!seatedSomewhere} />
            ))}
          </ul>
        )}
      </section>

      {!seatedSomewhere && (
        <section className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="font-medium">Host a draft</h2>
          {choices.length === 0 ? (
            <p className="text-sm text-zinc-500">
              No set with a draft booster is enabled and priced. An admin can enable one.
            </p>
          ) : (
            <form action={createDraftAction} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Set</span>
                <select name="booster" required className={field}>
                  {choices.map((choice) => (
                    <option
                      key={`${choice.setCode}/${choice.boosterType}`}
                      value={`${choice.setCode}/${choice.boosterType}`}
                    >
                      {choice.setName} ({boosterLabel(choice.boosterType)}):{" "}
                      {Cents.format(choice.fee)} to enter
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap gap-4">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">Players, at most</span>
                  <select name="maxSeats" defaultValue={MAX_SEATS} className={field}>
                    {Array.from({ length: MAX_SEATS - MIN_SEATS + 1 }, (_, index) => {
                      const seats = MIN_SEATS + index;
                      return (
                        <option key={seats} value={seats}>
                          {seats}
                        </option>
                      );
                    })}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">Pick timer</span>
                  <select
                    name="secondsPerPick"
                    defaultValue={DEFAULT_PICK_SECONDS}
                    className={field}
                  >
                    {TIMER_CHOICES.map((seconds) => (
                      <option key={seconds} value={seconds}>
                        {timerLabel(seconds)}
                      </option>
                    ))}
                    <option value="off">{timerLabel(null)}</option>
                  </select>
                </label>
              </div>
              <p className="text-xs text-zinc-500">
                You pay the entry fee now and get it back if you close the lobby before it starts.
                When the timer runs out, the app picks for you: a card that suits what you have.
                Someone who loses their connection gets up to 5 extra minutes.
              </p>
              <div>
                <SubmitButton pendingText="Opening the lobby…">Host and pay the fee</SubmitButton>
              </div>
            </form>
          )}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">Your finished drafts</h2>
        {overview.finished.length === 0 ? (
          <p className="text-sm text-zinc-500">None yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
            {overview.finished.map((draft) => (
              <li key={draft.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <SetSymbol keyruneCode={draft.keyruneCode} className="text-lg" />
                <Link href={`/drafts/${draft.id}`} className="underline">
                  {draft.setName}
                </Link>
                <span className="text-sm text-zinc-500">{draft.seats} players</span>
                {draft.deckId !== null && (
                  <Link href={`/decks/${draft.deckId}`} className="text-sm underline">
                    your deck
                  </Link>
                )}
                <span className="flex-1" />
                {draft.finishedAt !== null && (
                  <span className="text-xs text-zinc-500">
                    <LocalTime iso={draft.finishedAt} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
