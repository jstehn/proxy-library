"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import { Alert, SubmitButton } from "@/ui/form";
import { buyAndOpenAction, buySealedAction } from "../actions";
import type { FormState } from "@/server/form-action";
import { Select } from "@/ui/field";

const initialState: FormState = { message: null, tone: null };
const QUANTITIES = [1, 2, 3, 4, 6, 9, 12, 24];

export function BuyForm(props: { productId: string; productName: string }) {
  const [quantity, setQuantity] = useState("1");
  const [buyState, buyFormAction] = useActionState(buySealedAction, initialState);
  const [openState, openFormAction] = useActionState(buyAndOpenAction, initialState);

  const feedback = openState.message ? openState : buyState;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <form action={buyFormAction} className="flex items-center gap-1.5">
          <input type="hidden" name="productId" value={props.productId} />
          <label className="text-sm">
            <span className="sr-only">How many {props.productName}</span>
            <Select
              name="quantity"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              aria-label={`How many ${props.productName}`}
            >
              {QUANTITIES.map((q) => (
                <option key={q} value={q}>
                  {q}
                </option>
              ))}
            </Select>
          </label>
          <SubmitButton pendingText="Buying…">Buy</SubmitButton>
        </form>
        <form action={openFormAction}>
          <input type="hidden" name="productId" value={props.productId} />
          <input type="hidden" name="quantity" value={quantity} />
          <SubmitButton tone="secondary" pendingText="Opening…">
            Buy &amp; open
          </SubmitButton>
        </form>
      </div>
      {feedback.message && (
        <Alert tone={feedback.tone}>
          {feedback.message}{" "}
          {feedback.tone === "success" && (
            <Link href="/inventory" className="underline">
              Open it
            </Link>
          )}
        </Alert>
      )}
    </div>
  );
}
