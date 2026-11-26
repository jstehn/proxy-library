"use client";

import { createContext, useContext, useRef, useState, useTransition, type ReactNode } from "react";
import { Button } from "@/ui/button";
import { openAction } from "./actions";

type OpenMode = "one" | "all";
type ButtonKind = "primary" | "all";

type ActiveOpening = Readonly<{
  groupKey: number;
  button: ButtonKind;
  statusText: string;
}>;

type OpenRequest = Readonly<{
  groupKey: number;
  button: ButtonKind;
  itemIds: readonly number[];
  mode: OpenMode;
  statusText: string;
}>;

type OpeningContextValue = Readonly<{
  isOpening: boolean;
  active: ActiveOpening | null;
  beginOpen: (request: OpenRequest) => void;
}>;

const OpeningContext = createContext<OpeningContextValue | null>(null);

function Spinner() {
  return (
    <svg
      className="h-4 w-4 shrink-0 motion-safe:animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-85" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v3a5 5 0 0 0-5 5H4z" />
    </svg>
  );
}

/**
 * Coordinates opening actions across the unopened list so clicking any Open button immediately
 * shows progress and disables further clicks until navigation completes.
 */
export function OpeningScope(props: { children: ReactNode }) {
  const [isPending, startTransition] = useTransition();
  const [active, setActive] = useState<ActiveOpening | null>(null);
  const submittingRef = useRef(false);

  function beginOpen(request: OpenRequest) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setActive({
      groupKey: request.groupKey,
      button: request.button,
      statusText: request.statusText,
    });
    const formData = new FormData();
    formData.set("itemIds", request.itemIds.join(","));
    formData.set("mode", request.mode);
    startTransition(async () => {
      try {
        await openAction(formData);
      } finally {
        submittingRef.current = false;
        setActive(null);
      }
    });
  }

  const isOpening = isPending || active !== null;

  return (
    <OpeningContext.Provider value={{ isOpening, active, beginOpen }}>
      {isOpening && active !== null && (
        <p
          role="status"
          aria-live="polite"
          className="border-line bg-surface text-foreground flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
        >
          <Spinner />
          <span>{active.statusText}</span>
        </p>
      )}
      {props.children}
    </OpeningContext.Provider>
  );
}

type OpenGroupButtonsProps = Readonly<{
  groupKey: number;
  name: string;
  contentKind: "product" | "pack" | "deck";
  isDeckProduct: boolean;
  canOpenAll: boolean;
  itemIds: readonly number[];
}>;

export function OpenGroupButtons(props: OpenGroupButtonsProps) {
  const opening = useContext(OpeningContext);
  if (opening === null) {
    throw new Error("OpenGroupButtons must be rendered inside OpeningScope");
  }

  const { groupKey, name, contentKind, isDeckProduct, canOpenAll, itemIds } = props;
  const count = itemIds.length;
  const isUnpack = contentKind === "product" && !isDeckProduct;
  const isPrimaryActive =
    opening.isOpening &&
    opening.active?.groupKey === groupKey &&
    opening.active.button === "primary";
  const isAllActive =
    opening.isOpening && opening.active?.groupKey === groupKey && opening.active.button === "all";

  const primaryLabel = isUnpack ? "Unpack" : "Open";
  const primaryPendingLabel = isUnpack ? "Unpacking…" : "Opening…";
  const primaryStatusText = isUnpack ? `Unpacking ${name}…` : `Opening ${name}…`;

  const allLabel = contentKind === "product" ? "Open everything inside" : `Open all ${count}`;
  const allPendingLabel =
    contentKind === "product"
      ? "Opening everything…"
      : contentKind === "pack"
        ? `Opening ${count} packs…`
        : `Opening all ${count}…`;
  const allStatusText =
    contentKind === "product"
      ? `Opening everything inside ${name}…`
      : `Opening ${count} × ${name}…`;

  return (
    <>
      <Button
        type="button"
        aria-label={`Open ${name}`}
        aria-busy={isPrimaryActive}
        disabled={opening.isOpening}
        className="inline-flex items-center gap-2"
        onClick={() =>
          opening.beginOpen({
            groupKey,
            button: "primary",
            itemIds: [itemIds[0]],
            mode: isDeckProduct ? "all" : "one",
            statusText: primaryStatusText,
          })
        }
      >
        {isPrimaryActive ? (
          <>
            <Spinner />
            <span>{primaryPendingLabel}</span>
          </>
        ) : (
          primaryLabel
        )}
      </Button>

      {canOpenAll && !isDeckProduct && (
        <Button
          type="button"
          variant="secondary"
          aria-label={`Open all ${name}`}
          aria-busy={isAllActive}
          disabled={opening.isOpening}
          className="inline-flex items-center gap-2"
          onClick={() =>
            opening.beginOpen({
              groupKey,
              button: "all",
              itemIds: contentKind === "product" ? itemIds.slice(0, 1) : itemIds,
              mode: "all",
              statusText: allStatusText,
            })
          }
        >
          {isAllActive ? (
            <>
              <Spinner />
              <span>{allPendingLabel}</span>
            </>
          ) : (
            allLabel
          )}
        </Button>
      )}
    </>
  );
}
