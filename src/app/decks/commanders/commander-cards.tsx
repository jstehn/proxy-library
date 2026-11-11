"use client";
import { useRef, useState } from "react";
import { Cents } from "@/shared/kernel";
import { commanderCardsAction, type CommanderCardsView } from "./actions";

// One commander's cards on Find a commander (design docs 36 and 39), loaded when opened:
// your on-plan cards and why, your cards for each role, and what the rest might cost; plus
// hover/focus/tap preview on the commander's thumbnail image.

type PreviewSpot = Readonly<{ left: number; top: number }>;
const PREVIEW_WIDTH = 260;
const PREVIEW_HEIGHT = Math.round((PREVIEW_WIDTH * 680) / 488);

export function CommanderThumbnail(props: { printingId: string; name: string }) {
  const [spot, setSpot] = useState<PreviewSpot | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  function show() {
    const box = buttonRef.current?.getBoundingClientRect();
    if (box === undefined) return;
    const left =
      box.right + 12 + PREVIEW_WIDTH <= window.innerWidth - 8
        ? box.right + 12
        : Math.max(8, box.left - PREVIEW_WIDTH - 12);
    const top = Math.max(8, Math.min(box.top - 20, window.innerHeight - PREVIEW_HEIGHT - 8));
    setSpot({ left, top });
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onMouseEnter={show}
        onMouseLeave={() => setSpot(null)}
        onFocus={show}
        onBlur={() => setSpot(null)}
        onClick={() => (spot ? setSpot(null) : show())}
        aria-label={`Preview ${props.name}`}
        className="shrink-0 self-start rounded-[4.5%] focus:outline-2 focus:outline-offset-2"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/images/${props.printingId}/small/front`}
          alt={props.name}
          loading="lazy"
          className="aspect-[146/204] w-16 rounded-[4.5%] bg-zinc-100 sm:w-20 dark:bg-zinc-800"
        />
      </button>
      {spot && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/images/${props.printingId}/normal/front`}
          alt=""
          aria-hidden
          data-card-preview
          width={PREVIEW_WIDTH}
          height={PREVIEW_HEIGHT}
          className="pointer-events-none fixed z-50 rounded-[4.5%] bg-zinc-200 shadow-2xl ring-1 ring-black/30 dark:bg-zinc-800"
          style={{ left: spot.left, top: spot.top, width: PREVIEW_WIDTH }}
        />
      )}
    </>
  );
}

type Loaded = CommanderCardsView | "loading" | "failed" | null;

export function CommanderCards(props: { oracleId: string; withReal: boolean }) {
  const [open, setOpen] = useState(false);
  const [cards, setCards] = useState<Loaded>(null);

  function toggle() {
    setOpen(!open);
    if (cards !== null) return;
    setCards("loading");
    void commanderCardsAction(props.oracleId, props.withReal).then((view) =>
      setCards(view ?? "failed"),
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="rounded-md border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700"
      >
        {open ? "Hide the cards" : "See the cards"}
      </button>
      {open && (
        <div className="flex w-full flex-col gap-3 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
          {cards === "loading" || cards === null ? (
            <p className="text-zinc-500">Looking through your cards…</p>
          ) : cards === "failed" ? (
            <p className="text-zinc-500">Couldn&apos;t look this commander up.</p>
          ) : (
            <CardsView cards={cards} />
          )}
        </div>
      )}
    </>
  );
}

function CardsView(props: { cards: CommanderCardsView }) {
  const { cards } = props;
  const forPlan = cards.missing.picks.filter((pick) => pick.fills === "on-plan").length;
  return (
    <>
      <section className="flex flex-col gap-1">
        <h3 className="text-xs font-medium text-zinc-500 uppercase">Your on-plan cards</h3>
        {cards.onPlan.length === 0 ? (
          <p className="text-zinc-500">
            {cards.plan === ""
              ? "Its text leads nothing these rules read, so no card counts as on-plan."
              : `None of your cards share ${cards.plan}.`}
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {cards.onPlan.map((card) => (
              <li key={card.name}>
                {card.name} <span className="text-xs text-zinc-500">{card.reasons}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="flex flex-col gap-1">
        <h3 className="text-xs font-medium text-zinc-500 uppercase">Your cards by role</h3>
        <ul className="flex flex-col gap-1">
          {cards.roles.map((role) => (
            <li key={role.label}>
              <span className="font-medium">
                {role.label} {role.have} of {role.target}
              </span>
              {role.names.length > 0 && (
                <span className="text-xs text-zinc-600 dark:text-zinc-400">
                  {" "}
                  {role.names.join(", ")}
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-1">
        <h3 className="text-xs font-medium text-zinc-500 uppercase">What the rest might cost</h3>
        {cards.missing.picks.length === 0 ? (
          <p className="text-zinc-500">Nothing to add from the store for the roles or slots.</p>
        ) : (
          <>
            <p>
              About {Cents.format(Cents.of(cards.missing.totalCents))} for{" "}
              {cards.missing.picks.length} {cards.missing.picks.length === 1 ? "card" : "cards"}:
              the cheapest store cards for the roles still short
              {forPlan > 0 && `, then ${forPlan} on-plan cards for the empty slots`}. An estimate,
              not a shopping list.
            </p>
            <details>
              <summary className="cursor-pointer text-xs underline">The cards</summary>
              <ul className="mt-1 flex flex-col gap-0.5 text-xs">
                {cards.missing.picks.map((pick) => (
                  <li key={pick.name}>
                    {pick.name} <span className="text-zinc-500">({pick.fills})</span>{" "}
                    {pick.priceCents !== null && Cents.format(Cents.of(pick.priceCents))}
                  </li>
                ))}
              </ul>
            </details>
          </>
        )}
      </section>
    </>
  );
}
