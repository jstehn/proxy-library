import Link from "next/link";
import { currentEconomySettings, nextPayday } from "@/modules/wallet";
import {
  totals,
  wishLines,
  wishlistAnswers,
  type WishLine,
  type WishStatus,
  type WishTarget,
} from "@/modules/wishlist";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { assertNever, Cents } from "@/shared/kernel";
import { Alert } from "@/ui/form";
import { LocalTime } from "@/ui/local-time";
import { removeWishAction } from "./actions";
import { offerLabel } from "./labels";
import { BuyWishForm, EditWishForm, RemoveWishButton } from "./wish-forms";

// The Wishlist page (design doc 26, section 9): each wish at today's price, how far your money
// is from it, and buying it.

const PREFERENCE_TEXT = { nonfoil: "nonfoil", foil: "foil", cheapest: "either finish" };

function targetText(target: WishTarget): string {
  return target.kind === "anyPrinting"
    ? `Any printing, ${PREFERENCE_TEXT[target.finish]}`
    : `Only this printing, ${target.finish}`;
}

export default async function WishlistPage(props: PageProps<"/wishlist">) {
  const actor = await requireActor();
  const { db, wallet, clock } = getContainer();
  const [answers, balance, settings] = await Promise.all([
    wishlistAnswers(db, actor.userId),
    // Also pays any allowance that has come due, as the header does (design doc 03).
    wallet.refreshWallet(actor.userId),
    currentEconomySettings(db),
  ]);
  const schedule = { anchor: settings.allowanceAnchor, periodDays: settings.allowancePeriodDays };
  const lines = wishLines(answers, {
    balance,
    allowance: settings.allowance,
    allowancePeriodDays: settings.allowancePeriodDays,
    nextPayday: nextPayday(schedule, clock.now()),
  });
  const sum = totals(lines);
  const searchParams = await props.searchParams;
  const bought = typeof searchParams.bought === "string" ? searchParams.bought : null;
  const paid = Number(searchParams.paid);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-12">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Wishlist</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Cards you want, at today&apos;s prices. Add one from a card&apos;s page in{" "}
          <Link href="/singles" className="underline">
            Singles
          </Link>
          .
        </p>
        {lines.length > 0 && (
          <p className="text-sm tabular-nums">
            {lines.length} {lines.length === 1 ? "wish" : "wishes"} · everything still missing{" "}
            <strong>{Cents.format(sum.all)}</strong> · you have{" "}
            <strong>{Cents.format(balance)}</strong>
            {sum.affordable > 0 && <> · you can afford {Cents.format(sum.affordable)} of it now</>}
          </p>
        )}
      </header>

      {bought !== null && Number.isSafeInteger(paid) && (
        <Alert tone="success">
          Bought {bought} for {Cents.format(Cents.of(paid))}. That was every copy you wanted, so
          it&apos;s off your list. It&apos;s in your{" "}
          <Link href="/collection" className="underline">
            collection
          </Link>
          .
        </Alert>
      )}

      {lines.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
          Your wishlist is empty. Open any card from{" "}
          <Link href="/singles" className="underline">
            Singles
          </Link>{" "}
          and choose <strong>Add to wishlist</strong>.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {lines.map((line) => (
            <WishRow key={line.wish.id} line={line} />
          ))}
        </ul>
      )}

      {settings.allowance > 0 && lines.some((line) => line.status.kind === "shortBy") && (
        <p className="text-xs text-zinc-500">
          Paydays assume you spend nothing else and prices stay where they are today.
        </p>
      )}
    </main>
  );
}

function WishRow(props: { line: WishLine }) {
  const { line } = props;
  const { wish, offer } = line;
  // The card to show and link to: today's offer, or the printing wished for.
  const printingId =
    offer?.printingId ?? (wish.target.kind === "exactPrinting" ? wish.target.printingId : null);
  const highlight = line.atTarget
    ? "border-emerald-400 dark:border-emerald-700"
    : "border-zinc-200 dark:border-zinc-800";

  return (
    <li className={`flex gap-3 rounded-lg border p-3 ${highlight}`}>
      {printingId !== null ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/images/${printingId}/small/front`}
          alt=""
          width={146}
          height={204}
          loading="lazy"
          className="aspect-[146/204] w-16 shrink-0 self-start rounded-[4.5%] bg-zinc-100 sm:w-20 dark:bg-zinc-800"
        />
      ) : (
        <div className="aspect-[146/204] w-16 shrink-0 self-start rounded-[4.5%] bg-zinc-100 sm:w-20 dark:bg-zinc-800" />
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h2 className="font-medium">
            {printingId !== null ? (
              <Link href={`/cards/${printingId}`} className="hover:underline">
                {line.name}
              </Link>
            ) : (
              line.name
            )}
          </h2>
          <span className="text-xs text-zinc-500 tabular-nums">
            own {line.owned} of {wish.quantity}
          </span>
        </div>
        <p className="text-xs text-zinc-500">
          {targetText(wish.target)}
          {wish.note && <> · &ldquo;{wish.note}&rdquo;</>}
        </p>

        {offer !== null && line.missing > 0 && (
          <p className="tabular-nums">
            {offerLabel(offer)} · <strong>{Cents.format(offer.price)}</strong> each
            <PriceChange cents={line.changeSinceSaved} />
            {wish.targetPrice !== null && (
              <span
                className={
                  line.atTarget ? "text-emerald-700 dark:text-emerald-400" : "text-zinc-500"
                }
              >
                {" "}
                · target {Cents.format(wish.targetPrice)}
                {line.atTarget && " ✓"}
              </span>
            )}
          </p>
        )}

        <Status status={line.status} total={line.total} missing={line.missing} />

        {line.missing > 0 && line.options.length > 0 && (
          <BuyWishForm
            wishId={wish.id}
            options={line.options}
            missing={line.missing}
            name={line.name}
          />
        )}
        <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
          <EditWishForm wish={wish} />
          <form action={removeWishAction}>
            <input type="hidden" name="wishId" value={wish.id} />
            <RemoveWishButton />
          </form>
        </div>
      </div>
    </li>
  );
}

function PriceChange(props: { cents: number | null }) {
  if (props.cents === null || props.cents === 0) return null;
  const isDown = props.cents < 0;
  return (
    <span
      className={
        isDown ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"
      }
    >
      {" "}
      · {isDown ? "▼" : "▲"} {Cents.format(Cents.of(Math.abs(props.cents)))} since you saved it
    </span>
  );
}

function Status(props: { status: WishStatus; total: number | null; missing: number }) {
  const { status } = props;
  const copies = props.missing === 1 ? "" : ` for ${props.missing}`;
  switch (status.kind) {
    case "fulfilled":
      return (
        <p className="text-emerald-700 dark:text-emerald-400">
          ✓ You own this. Remove it when you&apos;re done.
        </p>
      );
    case "notForSale":
      return (
        <p className="text-zinc-500">
          Not for sale: no printing that fits is in an enabled set with a price.
        </p>
      );
    case "affordable":
      return (
        <p className="text-emerald-700 dark:text-emerald-400">
          You can afford this
          {props.total !== null && copies && ` (${Cents.format(Cents.of(props.total))}${copies})`}.
        </p>
      );
    case "shortBy":
      return (
        <p className="text-amber-700 dark:text-amber-400">
          {Cents.format(status.shortfall)} short
          {copies && ` (${Cents.format(Cents.of(props.total ?? 0))}${copies})`}
          {status.paydays !== null && (
            <>
              : about {status.paydays.count} {status.paydays.count === 1 ? "payday" : "paydays"} (
              <LocalTime iso={status.paydays.date.toISOString()} />)
            </>
          )}
          .
        </p>
      );
    default:
      return assertNever(status);
  }
}
