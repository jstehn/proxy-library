"use client";
// Type-ahead search of your own cards for the deck builder (feedback 2026-09-27): matches appear
// as you type, the arrow keys move through them, and Enter adds the highlighted card. It follows
// the "combobox" pattern, so screen readers announce the list and the highlighted option.
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import type { Board, OwnedCardMatch } from "@/modules/decks";
import { addCardAction, searchOwnedAction } from "../actions";

const WAIT_MILLISECONDS = 150; // wait for a pause in typing before searching

type CardSearchProps = {
  deckId: number;
  boards: readonly Board[];
  boardLabels: Readonly<Record<Board, string>>;
};

export function CardSearch(props: CardSearchProps) {
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<OwnedCardMatch[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [board, setBoard] = useState<Board>(props.boards[0]);
  const [message, setMessage] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const latestQuery = useRef("");

  // Search after a short pause. Answers to older queries are ignored if they arrive late.
  useEffect(() => {
    latestQuery.current = query;
    if (query.trim() === "") return;
    const timer = setTimeout(() => {
      void searchOwnedAction(query).then((found) => {
        if (latestQuery.current !== query) return;
        setMatches(found);
        setActive(0);
        setOpen(true);
      });
    }, WAIT_MILLISECONDS);
    return () => clearTimeout(timer);
  }, [query]);

  function add(card: OwnedCardMatch) {
    startTransition(async () => {
      const result = await addCardAction({ deckId: props.deckId, board, card });
      setMessage(result.message);
      if (result.ok) router.refresh(); // show the new line in the deck
    });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(index + 1, matches.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const card = matches[active];
      if (open && card !== undefined) add(card);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  const showList = open && query.trim() !== "";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            role="combobox"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={showList && matches[active] ? `${listId}-${active}` : undefined}
            aria-label="Search your cards"
            placeholder="Type a card name…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              if (event.target.value.trim() === "") {
                setMatches([]);
                setOpen(false);
              }
            }}
            onKeyDown={onKeyDown}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)} // let a click on an option land first
            className="w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700"
          />
          {showList && (
            <ul
              id={listId}
              role="listbox"
              aria-label="Matching cards you own"
              className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-auto rounded-md border border-zinc-300 bg-white text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
            >
              {matches.length === 0 ? (
                <li className="px-2 py-1.5 text-zinc-500">None of your cards match.</li>
              ) : (
                matches.map((match, index) => (
                  <li
                    key={match.oracleId}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={index === active}
                    onMouseDown={(event) => event.preventDefault()} // keep focus in the input
                    onMouseEnter={() => setActive(index)}
                    onClick={() => add(match)}
                    className={`flex cursor-pointer justify-between gap-2 px-2 py-1.5 ${index === active ? "bg-sky-100 dark:bg-sky-900" : ""}`}
                  >
                    <span>{match.name}</span>
                    <span className="shrink-0 text-xs whitespace-nowrap text-zinc-500">
                      own {match.owned}
                    </span>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
        <select
          aria-label="Add to"
          value={board}
          onChange={(event) =>
            setBoard(props.boards.find((option) => option === event.target.value) ?? board)
          }
          className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700"
        >
          {props.boards.map((option) => (
            <option key={option} value={option}>
              to {props.boardLabels[option]}
            </option>
          ))}
        </select>
      </div>
      <p className="text-xs text-zinc-500" aria-live="polite">
        {message ?? "↑ ↓ to choose, Enter to add."}
      </p>
    </div>
  );
}
