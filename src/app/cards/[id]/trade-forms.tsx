"use client";
import { useActionState } from "react";
import { Alert, SubmitButton } from "@/ui/form";
import { buySingleAction, sellSingleAction, type TradeState } from "./actions";

const initialState: TradeState = { message: null, tone: "success" };
const select =
  "rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700";

type TradeFormProps = {
  printingId: string;
  finish: string;
  finishLabel: string;
  /** How many can be chosen: 1 to this. */
  maxQuantity: number;
  /** "$1.20 each", shown on the button. */
  priceText: string;
};

function Hidden(props: { printingId: string; finish: string }) {
  return (
    <>
      <input type="hidden" name="printingId" value={props.printingId} />
      <input type="hidden" name="finish" value={props.finish} />
    </>
  );
}

function QuantitySelect(props: { max: number; label: string }) {
  return (
    <select name="quantity" defaultValue="1" aria-label={props.label} className={select}>
      {Array.from({ length: props.max }, (_, index) => index + 1).map((quantity) => (
        <option key={quantity} value={quantity}>
          {quantity}
        </option>
      ))}
    </select>
  );
}

export function BuyForm(props: TradeFormProps) {
  const [state, formAction] = useActionState(buySingleAction, initialState);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <Hidden printingId={props.printingId} finish={props.finish} />
      <div className="flex items-center gap-2">
        <QuantitySelect max={props.maxQuantity} label={`How many ${props.finishLabel} to buy`} />
        <SubmitButton pendingText="Buying…">Buy ({props.priceText})</SubmitButton>
      </div>
      {state.message && <Alert tone={state.tone}>{state.message}</Alert>}
    </form>
  );
}

/**
 * Stays on the page even when you own none (disabled), so the "Sold for …" message is still
 * there after selling your last copy.
 */
export function SellForm(props: TradeFormProps) {
  const [state, formAction] = useActionState(sellSingleAction, initialState);
  const ownsSome = props.maxQuantity > 0;
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <Hidden printingId={props.printingId} finish={props.finish} />
      <fieldset disabled={!ownsSome} className="flex items-center gap-2 disabled:opacity-50">
        <QuantitySelect
          max={Math.max(1, props.maxQuantity)}
          label={`How many ${props.finishLabel} to sell`}
        />
        <SubmitButton pendingText="Selling…" tone="secondary">
          Sell ({props.priceText})
        </SubmitButton>
      </fieldset>
      {state.message && <Alert tone={state.tone}>{state.message}</Alert>}
    </form>
  );
}
