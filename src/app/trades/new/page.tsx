import Link from "next/link";
import { printingCards, type PrintingCard } from "@/modules/catalog";
import { collectionPage, type CollectionRow } from "@/modules/collection";
import { tradingPartners } from "@/modules/trades";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { Cents, UserId } from "@/shared/kernel";
import { Alert } from "@/ui/form";
import { proposeTradeAction } from "../actions";
import { adjust, draftHref, readDraft, type Draft, type DraftCard } from "../draft";

// The trade builder (design doc 10, section 9). The draft lives in the URL: each + and − is a
// link to the same page with one thing changed, so it works without JavaScript and the back
// button undoes a change.

const field =
  "rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700";
const smallButton = "rounded border border-zinc-300 px-2 text-sm leading-6 dark:border-zinc-700";
const FINISH = { nonfoil: "", foil: " (foil)", etched: " (etched)" };

function cardName(card: DraftCard, cards: Map<string, PrintingCard>): string {
  return `${cards.get(card.printingId)?.name ?? "Unknown card"}${FINISH[card.finish]}`;
}

/** One side's search results, each with a link that adds a copy to the draft. */
function Offerable(props: {
  rows: readonly CollectionRow[];
  cards: Map<string, PrintingCard>;
  draft: Draft;
  side: "give" | "get";
}) {
  const { draft, side } = props;
  if (props.rows.length === 0) return <p className="text-sm text-zinc-500">No cards match.</p>;
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {props.rows.map((row) => {
        const card = { printingId: row.printingId, finish: row.finish };
        const chosen =
          draft[side].find(
            (item) => item.printingId === row.printingId && item.finish === row.finish,
          )?.quantity ?? 0;
        const canAdd = chosen < row.quantity;
        return (
          <li key={`${row.printingId}/${row.finish}`} className="flex items-center gap-2">
            <span className="flex-1">
              {cardName({ ...card, quantity: 1 }, props.cards)}{" "}
              <span className="text-xs text-zinc-500">
                has {row.quantity}
                {row.price !== null && ` · ${Cents.format(Cents.of(row.price))}`}
              </span>
            </span>
            {canAdd && (
              <Link
                href={draftHref({ ...draft, [side]: adjust(draft[side], card, 1) })}
                className={smallButton}
                aria-label={`Add ${cardName({ ...card, quantity: 1 }, props.cards)}`}
              >
                + add
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Chosen(props: {
  title: string;
  cards: Map<string, PrintingCard>;
  draft: Draft;
  side: "give" | "get";
}) {
  const { draft, side } = props;
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-sm font-medium">{props.title}</h3>
      {draft[side].length === 0 ? (
        <p className="text-sm text-zinc-500">No cards yet.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {draft[side].map((card) => (
            <li key={`${card.printingId}/${card.finish}`} className="flex items-center gap-2">
              <span className="w-6 text-right tabular-nums">{card.quantity}</span>
              <span className="flex-1">{cardName(card, props.cards)}</span>
              <Link
                href={draftHref({ ...draft, [side]: adjust(draft[side], card, -1) })}
                className={smallButton}
                aria-label={`One fewer ${cardName(card, props.cards)}`}
              >
                −
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default async function NewTradePage(props: PageProps<"/trades/new">) {
  const actor = await requireActor();
  const { db } = getContainer();
  const searchParams = await props.searchParams;
  const draft = readDraft(searchParams);
  const partners = await tradingPartners(db, actor.userId);
  const partner = partners.find((candidate) => candidate.userId === draft.withUserId) ?? null;
  const error = typeof searchParams.error === "string" ? searchParams.error : null;

  if (partner === null) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-12">
        <h1 className="text-2xl font-semibold">New trade</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Who do you want to trade with?</p>
        {partners.length === 0 ? (
          <p className="text-sm text-zinc-500">There&apos;s nobody else to trade with yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {partners.map((candidate) => (
              <li key={candidate.userId}>
                <Link
                  href={draftHref({ ...draft, withUserId: candidate.userId })}
                  className="underline"
                >
                  {candidate.displayName}
                </Link>{" "}
                <span className="text-xs text-zinc-500">@{candidate.username}</span>
              </li>
            ))}
          </ul>
        )}
      </main>
    );
  }

  const search = (userId: string, name: string) =>
    collectionPage(db, UserId.of(userId), {
      name: name || undefined,
      sections: "none",
      sort: "name",
      page: 1,
    });
  const [mine, theirs] = await Promise.all([
    search(actor.userId, draft.mine),
    search(partner.userId, draft.theirs),
  ]);
  const cards = await printingCards(db, [
    ...mine.rows.map((row) => row.printingId),
    ...theirs.rows.map((row) => row.printingId),
    ...draft.give.map((card) => card.printingId),
    ...draft.get.map((card) => card.printingId),
  ]);

  // Hidden fields that carry the rest of the draft through a search or money form.
  const keep = (except: string[]) =>
    Object.entries(Object.fromEntries(new URL(`http://x${draftHref(draft)}`).searchParams))
      .filter(([key]) => !except.includes(key))
      .map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-12">
      <header>
        <h1 className="text-2xl font-semibold">
          {draft.replaces ? "Counter-offer" : "Trade"} with {partner.displayName}
        </h1>
        <p className="text-sm text-zinc-500">
          Add cards from both collections and any money, then send it. Nothing moves until{" "}
          {partner.displayName} accepts.{" "}
          <Link href="/trades/new" className="underline">
            Choose someone else
          </Link>
        </p>
      </header>
      {error && <Alert tone="error">{error}</Alert>}

      <div className="flex flex-col gap-6 md:flex-row">
        {(["give", "get"] as const).map((side) => {
          const isGive = side === "give";
          const queryName = isGive ? "mine" : "theirs";
          return (
            <section
              key={side}
              className="flex flex-1 flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
            >
              <h2 className="font-medium">
                {isGive ? "You give" : `${partner.displayName} gives`}
              </h2>
              <Chosen title="Cards" cards={cards} draft={draft} side={side} />
              <form method="get" className="flex items-center gap-2">
                {keep([isGive ? "giveMoney" : "getMoney"])}
                <label className="text-sm">
                  Money $
                  <input
                    name={isGive ? "giveMoney" : "getMoney"}
                    defaultValue={isGive ? draft.giveMoney : draft.getMoney}
                    placeholder="0.00"
                    aria-label={isGive ? "Money you give" : "Money they give"}
                    className={`${field} ml-1 w-24`}
                  />
                </label>
                <button type="submit" className={field}>
                  Set
                </button>
              </form>
              <form method="get" className="flex gap-2">
                {keep([queryName])}
                <input
                  name={queryName}
                  defaultValue={isGive ? draft.mine : draft.theirs}
                  placeholder={
                    isGive ? "Search your cards" : `Search ${partner.displayName}'s cards`
                  }
                  aria-label={isGive ? "Search your cards" : "Search their cards"}
                  className={`${field} flex-1`}
                />
                <button type="submit" className={field}>
                  Search
                </button>
              </form>
              <Offerable
                rows={(isGive ? mine : theirs).rows}
                cards={cards}
                draft={draft}
                side={side}
              />
            </section>
          );
        })}
      </div>

      <form action={proposeTradeAction} className="flex flex-col gap-2">
        {keep(["mine", "theirs"])}
        <textarea
          name="message"
          rows={2}
          maxLength={300}
          placeholder="A message (optional)"
          aria-label="Message"
          className={field}
        />
        <div>
          <button
            type="submit"
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            {draft.replaces ? "Send counter-offer" : "Propose trade"}
          </button>
        </div>
      </form>
    </main>
  );
}
