"use client";
import Link from "next/link";
import { useActionState } from "react";
import { addRealProductAction, type RealProductState } from "@/app/collection/real/actions";
import { Alert, SubmitButton } from "@/ui/form";

// "I own this for real" under a product (design doc 16, section 15): adds the product's known
// cards to your real collection and makes decks from its precons. A product holding "one of
// these" asks which one you got first.

const initialState: RealProductState = { kind: "Idle" };

export function RealProductForm(props: {
  productId: string;
  productName: string;
  ownedForReal: number;
}) {
  const [state, formAction] = useActionState(addRealProductAction, initialState);
  const choices = state.kind === "Choose" ? state.choices : [];

  return (
    <div className="flex flex-col gap-2 text-sm">
      {state.kind === "Choose" ? (
        <form action={formAction} className="flex flex-col gap-2">
          <input type="hidden" name="productId" value={props.productId} />
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 font-medium">Which one did you get?</legend>
            {state.options.map((option, index) => (
              <label key={index} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="choices"
                  value={[...choices.slice(0, state.index), index].join(",")}
                  defaultChecked={index === 0}
                />
                {option}
              </label>
            ))}
          </fieldset>
          <SubmitButton tone="secondary" pendingText="Adding…">
            Add it
          </SubmitButton>
        </form>
      ) : (
        <form action={formAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="productId" value={props.productId} />
          <SubmitButton tone="secondary" pendingText="Adding…">
            I own this for real
          </SubmitButton>
          {props.ownedForReal > 0 && (
            <span className="text-xs text-zinc-500">You own {props.ownedForReal} for real</span>
          )}
        </form>
      )}
      {state.kind === "Error" && <Alert tone="error">{state.message}</Alert>}
      {state.kind === "Added" && (
        <Alert tone="success">
          Added {state.cards} {state.cards === 1 ? "card" : "cards"} to your{" "}
          <Link href="/collection/real" className="underline">
            real collection
          </Link>
          .
          {state.decks.map((deck) => (
            <span key={deck.id}>
              {" "}
              New deck:{" "}
              <Link href={`/decks/${deck.id}`} className="underline">
                {deck.name}
              </Link>
              .
            </span>
          ))}
          {state.decksNotMade.length > 0 &&
            ` No deck was made for ${state.decksNotMade.join(", ")} (you have the most decks allowed).`}
          {state.notAdded.length > 0 && (
            <>
              {" "}
              Not added: {state.notAdded.join(", ")}.{" "}
              <Link href="/collection/real/import" className="underline">
                Import what you pulled
              </Link>
              .
            </>
          )}
        </Alert>
      )}
    </div>
  );
}
