import Link from "next/link";
import { notFound } from "next/navigation";
import { DraftId, type DraftView } from "@/modules/drafts";
import { readPage } from "@/server/page-instance";
import { Cents } from "@/shared/kernel";
import { Alert } from "@/ui/form";
import { Page } from "@/ui/page";
import { KeyruneStylesheet, SetSymbol } from "@/ui/mtg/set-symbol";
import { DRAFTS_PATH } from "../paths";
import { boosterLabel, timerLabel } from "../labels";
import { Dealing, RevealLog, type Names } from "./_components/conspiracy";
import { Drafting } from "./_components/drafting";
import { loreSources, printingIdsIn } from "./_components/draft-sources";
import { Finished } from "./_components/finished";
import { LiveUpdates } from "./_components/live-updates";
import { Lobby } from "./_components/lobby";
import { Picks } from "./_components/pool-view";

// One draft (design docs 17 and 18): the lobby, the pick screen with the table around it, the
// Deal Broker stage and the finished pool. Names, deadlines and presence come from `reads.drafts.view`;
// everything about cards comes from `drafts.view`, which returns only what this player may see
// (design doc 18, section 4). LiveUpdates reloads both whenever the draft changes.

const STATUS_TEXT: Record<DraftView["status"], string> = {
  lobby: "Waiting for players",
  drafting: "Drafting",
  dealing: "Making deals",
  finished: "Finished",
  cancelled: "Cancelled",
};

export default async function DraftPage(props: PageProps<"/drafts/[id]">) {
  const { actor, capabilities, reads } = await readPage();
  const draftId = Number((await props.params).id);
  if (!Number.isSafeInteger(draftId) || draftId <= 0) notFound();
  const now = capabilities.now();
  const [view, seen] = await Promise.all([
    reads.drafts.view(actor, draftId, now),
    capabilities.drafts.view(actor, DraftId.of(draftId)),
  ]);
  if (view === null || seen === null) notFound();
  const error = (await props.searchParams).error;

  const printings = await capabilities.printingDetails(printingIdsIn(seen));
  const names: Names = {
    seat: (seatNumber) =>
      seatNumber === null
        ? "nobody"
        : (view.seats.find((seat) => seat.seatNumber === seatNumber)?.name ??
          `seat ${seatNumber + 1}`),
    printing: (printingId) => printings.get(printingId)?.name ?? "a card",
    printings,
  };
  const isLive = view.status === "lobby" || view.status === "drafting" || view.status === "dealing";

  return (
    <Page width="6xl" spacing="tight">
      <KeyruneStylesheet />
      <header className="flex flex-col gap-1">
        <Link href={DRAFTS_PATH} className="text-sm underline">
          All drafts
        </Link>
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
          <SetSymbol keyruneCode={view.keyruneCode} />
          {view.setName} draft
          {isLive && <LiveUpdates draftId={view.id} version={view.version} />}
        </h1>
        <p className="text-muted text-sm">
          {STATUS_TEXT[view.status]} · {boosterLabel(view.boosterType)} · hosted by {view.hostName}{" "}
          · {Cents.format(view.entryFee)} to enter · {timerLabel(view.secondsPerPick)}
        </p>
      </header>
      {typeof error === "string" && <Alert tone="error">{error}</Alert>}

      {view.status === "lobby" && <Lobby view={view} canAddBots={actor.isAdmin && view.isHost} />}
      {view.status === "drafting" && (
        <Drafting
          view={view}
          seen={seen}
          names={names}
          serverNow={now.toISOString()}
          lore={await loreSources(capabilities, reads, seen, actor)}
        />
      )}
      {view.status === "dealing" && seen.deal !== null && (
        <>
          <Dealing
            draftId={view.id}
            deal={seen.deal}
            you={seen.you}
            isHost={view.isHost}
            names={names}
          />
          {seen.you !== null && <Picks cards={seen.you.pool} printings={printings} />}
        </>
      )}
      {view.status === "finished" && <Finished view={view} seen={seen} printings={printings} />}
      {view.status === "cancelled" && (
        <p className="text-muted text-sm">
          The host closed this lobby before it started. Everyone got their entry fee back.
        </p>
      )}
      {view.status !== "lobby" && (
        <RevealLog reveals={seen.reveals} names={names} you={seen.you?.seatNumber ?? null} />
      )}
    </Page>
  );
}
