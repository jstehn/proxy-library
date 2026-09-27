"use client";
import Link from "next/link";
import { useActionState } from "react";
import { Alert, SubmitButton } from "@/ui/form";
import { buySealedAction, type BuyState } from "../actions";

const initialState: BuyState = { message: null, tone: "success" };
const QUANTITIES = [1, 2, 3, 4, 6, 9, 12, 24];

export function BuyForm(props: { productId: string; productName: string }) {
  const [state, formAction] = useActionState(buySealedAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="productId" value={props.productId} />
      <div className="flex items-center gap-2">
        <label className="text-sm">
          <span className="sr-only">How many {props.productName}</span>
          <select
            name="quantity"
            defaultValue="1"
            aria-label={`How many ${props.productName}`}
            className="rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700"
          >
            {QUANTITIES.map((quantity) => (
              <option key={quantity} value={quantity}>
                {quantity}
              </option>
            ))}
          </select>
        </label>
        <SubmitButton pendingText="Buying…">Buy</SubmitButton>
      </div>
      {state.message && (
        <Alert tone={state.tone}>
          {state.message}{" "}
          {state.tone === "success" && (
            <Link href="/inventory" className="underline">
              Open it
            </Link>
          )}
        </Alert>
      )}
    </form>
  );
}
