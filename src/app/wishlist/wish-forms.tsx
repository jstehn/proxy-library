"use client";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import type { Finish } from "@/modules/catalog";
import type { FinishPreference, Offer, Wish } from "@/modules/wishlist";
import { Cents } from "@/shared/kernel";
import { Alert, SubmitButton } from "@/ui/form";
import { addWishAction, buyWishAction, updateWishAction, type WishState } from "./actions";
import { FINISH_NAMES, offerLabel } from "./labels";

// The wishlist's forms (design doc 26, section 9): buying a wish, changing it, and adding one
// from a card's page.

const initialState: WishState = { message: null, tone: "success" };
const field =
  "rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700";

const PREFERENCE_OPTIONS: readonly (readonly [FinishPreference, string])[] = [
  ["nonfoil", "Nonfoil"],
  ["foil", "Foil (or etched)"],
  ["cheapest", "Whichever is cheaper"],
];

const offerKey = (offer: Offer) => `${offer.printingId}/${offer.finish}`;

function Numbers(props: {
  max: number;
  name: string;
  label: string;
  value: number;
  onChange?: (value: number) => void;
}) {
  return (
    <select
      name={props.name}
      aria-label={props.label}
      value={props.value}
      onChange={(event) => props.onChange?.(Number(event.target.value))}
      className={field}
    >
      {Array.from({ length: props.max }, (_, index) => index + 1).map((count) => (
        <option key={count} value={count}>
          {count}
        </option>
      ))}
    </select>
  );
}

/**
 * Buy the copies still missing: the best offer, or another printing from the menu. The price
 * the page showed goes with the form, so a price rise is refused (rule 7).
 */
export function BuyWishForm(props: {
  wishId: number;
  options: readonly Offer[];
  missing: number;
  name: string;
}) {
  const [state, formAction] = useActionState(buyWishAction, initialState);
  const [chosenKey, setChosenKey] = useState(offerKey(props.options[0]));
  const [quantity, setQuantity] = useState(props.missing);
  // The best offer can change after a purchase or a sync; fall back to it if the choice went.
  const chosen = props.options.find((option) => offerKey(option) === chosenKey) ?? props.options[0];
  const count = Math.min(quantity, props.missing);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="wishId" value={props.wishId} />
      <input type="hidden" name="name" value={props.name} />
      <input type="hidden" name="printingId" value={chosen.printingId} />
      <input type="hidden" name="finish" value={chosen.finish} />
      <input type="hidden" name="expectedUnitPrice" value={chosen.price} />
      <div className="flex flex-wrap items-center gap-2">
        {props.options.length > 1 && (
          <select
            aria-label={`Which printing of ${props.name} to buy`}
            value={offerKey(chosen)}
            onChange={(event) => setChosenKey(event.target.value)}
            className={`${field} max-w-full`}
          >
            {props.options.map((option) => (
              <option key={offerKey(option)} value={offerKey(option)}>
                {offerLabel(option)}: {Cents.format(option.price)}
              </option>
            ))}
          </select>
        )}
        {props.missing > 1 ? (
          <Numbers
            name="quantity"
            label={`How many ${props.name} to buy`}
            max={props.missing}
            value={count}
            onChange={setQuantity}
          />
        ) : (
          <input type="hidden" name="quantity" value={1} />
        )}
        <SubmitButton pendingText="Buying…">
          Buy {count > 1 ? `${count} ` : ""}({Cents.format(Cents.of(chosen.price * count))})
        </SubmitButton>
      </div>
      {state.message && <Alert tone={state.tone}>{state.message}</Alert>}
    </form>
  );
}

/** The fields a wish's owner can change: copies, target price, note. */
function DetailFields(props: { quantity: number; targetPrice: number | null; note: string }) {
  return (
    <>
      <label className="flex items-center gap-2 text-sm">
        <span className="w-24 shrink-0">Copies wanted</span>
        <input
          name="quantity"
          type="number"
          min={1}
          max={99}
          defaultValue={props.quantity}
          className={`${field} w-20`}
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <span className="w-24 shrink-0">Target price</span>
        <input
          name="targetPrice"
          inputMode="decimal"
          placeholder="none"
          defaultValue={
            props.targetPrice === null ? "" : Cents.toPlainDollars(Cents.of(props.targetPrice))
          }
          className={`${field} w-28`}
        />
        <span className="text-xs text-zinc-500">$ per copy, optional</span>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <span className="w-24 shrink-0">Note</span>
        <input
          name="note"
          maxLength={200}
          defaultValue={props.note}
          placeholder="optional"
          className={`${field} min-w-0 flex-1`}
        />
      </label>
    </>
  );
}

export function EditWishForm(props: { wish: Wish }) {
  const [state, formAction] = useActionState(updateWishAction, initialState);
  const { wish } = props;
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-zinc-600 underline dark:text-zinc-400">Edit</summary>
      <form action={formAction} className="mt-2 flex flex-col gap-2">
        <input type="hidden" name="wishId" value={wish.id} />
        <DetailFields quantity={wish.quantity} targetPrice={wish.targetPrice} note={wish.note} />
        <div>
          <SubmitButton pendingText="Saving…" tone="secondary">
            Save
          </SubmitButton>
        </div>
        {state.message && <Alert tone={state.tone}>{state.message}</Alert>}
      </form>
    </details>
  );
}

/**
 * "Add to wishlist" on a card's page: this card in any printing (the default) or this exact
 * printing, in a finish it comes in.
 */
export function AddWishForm(props: {
  printingId: string;
  finishes: readonly Finish[];
  printingLabel: string;
}) {
  const [state, formAction] = useActionState(addWishAction, initialState);
  const [kind, setKind] = useState<"anyPrinting" | "exactPrinting">("anyPrinting");
  const finishOptions: readonly (readonly [string, string])[] =
    kind === "anyPrinting"
      ? PREFERENCE_OPTIONS
      : props.finishes.map((finish) => [finish, FINISH_NAMES[finish]] as const);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="printingId" value={props.printingId} />
      <fieldset className="flex flex-col gap-1 text-sm">
        <legend className="sr-only">Which printing</legend>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="kind"
            value="anyPrinting"
            checked={kind === "anyPrinting"}
            onChange={() => setKind("anyPrinting")}
          />
          Any printing (buys the cheapest one for sale)
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="kind"
            value="exactPrinting"
            checked={kind === "exactPrinting"}
            onChange={() => setKind("exactPrinting")}
          />
          Only this printing ({props.printingLabel})
        </label>
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <span className="w-24 shrink-0">Finish</span>
        {/* `key`: switching kinds starts the menu at its first choice. */}
        <select key={kind} name="finish" className={field}>
          {finishOptions.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <DetailFields quantity={1} targetPrice={null} note="" />
      <div>
        <SubmitButton pendingText="Adding…" tone="secondary">
          Add to wishlist
        </SubmitButton>
      </div>
      {state.message && <Alert tone={state.tone}>{state.message}</Alert>}
    </form>
  );
}

/** Remove, as a text button (the row disappears once the server action is done). */
export function RemoveWishButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="text-sm text-zinc-600 underline disabled:opacity-60 dark:text-zinc-400"
    >
      {pending ? "Removing…" : "Remove"}
    </button>
  );
}
