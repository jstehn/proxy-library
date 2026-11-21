import Link from "next/link";
import { DEFAULT_PICK_SECONDS, MAX_SEATS, MIN_SEATS, type DraftSummary } from "@/modules/drafts";
import { readPage } from "@/server/page-instance";
import { Cents } from "@/shared/kernel";
import { Alert, SubmitButton } from "@/ui/form";
import { LocalTime } from "@/ui/local-time";
import { KeyruneStylesheet, SetSymbol } from "@/ui/set-symbol";
import { createDraftAction, joinDraftAction } from "./actions";
import { boosterLabel, timerLabel } from "./labels";
import { Select } from "@/ui/field";
import { Card } from "@/ui/card";
import { Page } from "@/ui/page";
import { EmptyState } from "@/ui/empty-state";
import { buttonClass } from "@/ui/button";

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
      <span className="text-muted text-sm">
        hosted by {draft.hostName} · {draft.seats}/{draft.maxSeats} players ·{" "}
        {Cents.format(draft.entryFee)} · {timerLabel(draft.secondsPerPick)}
      </span>
      <span className="flex-1" />
      {draft.youAreSeated ? (
        <Link href={`/drafts/${draft.id}`} className={buttonClass()}>
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
  const { actor, reads } = await readPage();
  const [overview, boosters, prices] = await Promise.all([
    reads.drafts.overview(actor),
    reads.drafts.boosters(),
    reads.store.packMsrps(),
  ]);
  const error = (await props.searchParams).error;
  const seatedSomewhere = overview.open.some((draft) => draft.youAreSeated);
  const choices = boosters.flatMap((booster) => {
    const price = prices.get(`${booster.setCode}/${booster.boosterType}`);
    return price === undefined ? [] : [{ ...booster, fee: Cents.of(price * PACKS_PER_PLAYER) }];
  });

  return (
    <Page spacing="roomy">
      <KeyruneStylesheet />
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Drafts</h1>
        <p className="text-muted text-sm">
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
          <EmptyState>No drafts right now. Host one below.</EmptyState>
        ) : (
          <ul className="divide-border-subtle flex flex-col divide-y">
            {overview.open.map((draft) => (
              <DraftRow key={draft.id} draft={draft} canJoin={!seatedSomewhere} />
            ))}
          </ul>
        )}
      </section>

      {!seatedSomewhere && (
        <Card as="section" padding="lg" stack>
          <h2 className="font-medium">Host a draft</h2>
          {choices.length === 0 ? (
            <p className="text-muted text-sm">
              No set with a draft booster is enabled and priced. An admin can enable one.
            </p>
          ) : (
            <form action={createDraftAction} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Set</span>
                <Select name="booster" required>
                  {choices.map((choice) => (
                    <option
                      key={`${choice.setCode}/${choice.boosterType}`}
                      value={`${choice.setCode}/${choice.boosterType}`}
                    >
                      {choice.setName} ({boosterLabel(choice.boosterType)}):{" "}
                      {Cents.format(choice.fee)} to enter
                    </option>
                  ))}
                </Select>
              </label>
              <div className="flex flex-wrap gap-4">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">Players, at most</span>
                  <Select name="maxSeats" defaultValue={MAX_SEATS}>
                    {Array.from({ length: MAX_SEATS - MIN_SEATS + 1 }, (_, index) => {
                      const seats = MIN_SEATS + index;
                      return (
                        <option key={seats} value={seats}>
                          {seats}
                        </option>
                      );
                    })}
                  </Select>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">Pick timer</span>
                  <Select name="secondsPerPick" defaultValue={DEFAULT_PICK_SECONDS}>
                    {TIMER_CHOICES.map((seconds) => (
                      <option key={seconds} value={seconds}>
                        {timerLabel(seconds)}
                      </option>
                    ))}
                    <option value="off">{timerLabel(null)}</option>
                  </Select>
                </label>
              </div>
              <p className="text-muted text-xs">
                You pay the entry fee now and get it back if you close the lobby before it starts.
                When the timer runs out, the app picks for you: a card that suits what you have.
                Someone who loses their connection gets up to 5 extra minutes.
              </p>
              <div>
                <SubmitButton pendingText="Opening the lobby…">Host and pay the fee</SubmitButton>
              </div>
            </form>
          )}
        </Card>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">Your finished drafts</h2>
        {overview.finished.length === 0 ? (
          <EmptyState>None yet.</EmptyState>
        ) : (
          <ul className="divide-border-subtle flex flex-col divide-y">
            {overview.finished.map((draft) => (
              <li key={draft.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <SetSymbol keyruneCode={draft.keyruneCode} className="text-lg" />
                <Link href={`/drafts/${draft.id}`} className="underline">
                  {draft.setName}
                </Link>
                <span className="text-muted text-sm">{draft.seats} players</span>
                {draft.deckId !== null && (
                  <Link href={`/decks/${draft.deckId}`} className="text-sm underline">
                    your deck
                  </Link>
                )}
                <span className="flex-1" />
                {draft.finishedAt !== null && (
                  <span className="text-muted text-xs">
                    <LocalTime iso={draft.finishedAt} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </Page>
  );
}
