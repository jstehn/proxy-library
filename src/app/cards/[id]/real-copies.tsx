import type { Finish } from "@/modules/catalog";
import { MAX_REAL_QUANTITY, type PrintingChoice } from "@/modules/real-collection";
import { changeRealPrintingAction, setRealCopiesAction } from "@/app/collection/real/actions";

// The card page's "Real copies" box (design doc 16, section 7): how many of this printing you
// own for real, per finish, with − and + and a number, and moving them to another printing.

const FINISH_LABELS: Record<Finish, string> = {
  nonfoil: "Nonfoil",
  foil: "Foil",
  etched: "Etched",
};
const ERRORS: Record<string, string> = {
  QuantityInvalid: `Choose a whole number from 0 to ${MAX_REAL_QUANTITY.toLocaleString("en-US")}.`,
  FinishNotAvailable: "That printing doesn't come in that finish.",
  PrintingNotFound: "That printing isn't in the catalog.",
  NotOwned: "You don't have real copies of that printing to move.",
  NotTheSameCard: "Copies can only move to another printing of the same card.",
};

const small =
  "rounded-md border border-zinc-300 px-2 py-1 text-sm tabular-nums dark:border-zinc-700";

function Stepper(props: {
  printingId: string;
  finish: Finish;
  quantity: number;
  change: number;
  label: string;
}) {
  const next = Math.max(0, Math.min(MAX_REAL_QUANTITY, props.quantity + props.change));
  return (
    <form action={setRealCopiesAction}>
      <input type="hidden" name="printingId" value={props.printingId} />
      <input type="hidden" name="finish" value={props.finish} />
      <input type="hidden" name="quantity" value={next} />
      <button
        type="submit"
        className={small}
        aria-label={props.label}
        disabled={next === props.quantity}
      >
        {props.change < 0 ? "−" : "+"}
      </button>
    </form>
  );
}

export function RealCopiesBox(props: {
  printingId: string;
  finishes: readonly Finish[];
  copies: Partial<Record<Finish, number>>;
  /** Other printings of the card, to move copies to. */
  printings: readonly PrintingChoice[];
  error: string | null;
}) {
  const owned = props.finishes.filter((finish) => (props.copies[finish] ?? 0) > 0);
  const targets = props.printings.flatMap((printing) =>
    printing.finishes.map((finish) => ({ printing, finish })),
  );
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-medium">Real copies</h2>
      <p className="text-xs text-zinc-500">
        Copies you own in real life. They count in decks that use your real cards, and never in the
        game.
      </p>
      {props.error !== null && (
        <p role="status" className="text-sm text-red-700 dark:text-red-400">
          {ERRORS[props.error] ?? "That didn't work."}
        </p>
      )}
      {props.finishes.map((finish) => {
        const quantity = props.copies[finish] ?? 0;
        const label = FINISH_LABELS[finish];
        return (
          <div key={finish} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-16">{label}</span>
            <Stepper
              printingId={props.printingId}
              finish={finish}
              quantity={quantity}
              change={-1}
              label={`One fewer real ${label.toLowerCase()} copy`}
            />
            <form action={setRealCopiesAction} className="flex items-center gap-2">
              <input type="hidden" name="printingId" value={props.printingId} />
              <input type="hidden" name="finish" value={finish} />
              <input
                type="number"
                name="quantity"
                min={0}
                max={MAX_REAL_QUANTITY}
                defaultValue={quantity}
                key={quantity}
                aria-label={`Real ${label.toLowerCase()} copies`}
                className={`${small} w-20 bg-transparent`}
              />
              <button type="submit" className={small}>
                Save
              </button>
            </form>
            <Stepper
              printingId={props.printingId}
              finish={finish}
              quantity={quantity}
              change={1}
              label={`One more real ${label.toLowerCase()} copy`}
            />
          </div>
        );
      })}
      {owned.length > 0 && targets.length > 1 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-zinc-600 dark:text-zinc-400">
            Wrong printing? Move them…
          </summary>
          {owned.map((finish) => (
            <form
              key={finish}
              action={changeRealPrintingAction}
              className="mt-2 flex flex-wrap items-center gap-2"
            >
              <input type="hidden" name="printingId" value={props.printingId} />
              <input type="hidden" name="finish" value={finish} />
              <span>
                {props.copies[finish]} {FINISH_LABELS[finish].toLowerCase()} to
              </span>
              <select
                name="to"
                aria-label="Move to which printing"
                className={`${small} max-w-full bg-transparent`}
              >
                {targets
                  .filter(
                    ({ printing, finish: target }) =>
                      printing.printingId !== props.printingId || target !== finish,
                  )
                  .map(({ printing, finish: target }) => (
                    <option
                      key={`${printing.printingId}/${target}`}
                      value={`${printing.printingId}/${target}`}
                    >
                      {printing.setName} #{printing.collectorNumber}
                      {printing.variantLabel && ` (${printing.variantLabel})`} ·{" "}
                      {FINISH_LABELS[target]}
                    </option>
                  ))}
              </select>
              <button type="submit" className={small}>
                Move
              </button>
            </form>
          ))}
        </details>
      )}
    </section>
  );
}
