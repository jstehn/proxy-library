"use client";
// Controls for the trade builder that read the draft from the URL **at the moment you use them**
// (feedback from the end-to-end test, design doc 10 section 13). The first version baked the
// draft into each link and form when the page was drawn, so submitting one form before another
// click had finished loading could send an outdated draft and drop a card.
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useTransition } from "react";
import { adjust, draftHref, readDraft, type Draft, type DraftCard } from "../draft";
import { proposeTradeAction } from "../actions";

/**
 * The newest draft asked for, while its page is still loading: `router.push` only changes the
 * address bar once the new page arrives, so a second quick click must build on this instead.
 */
let requestedSearch: string | null = null;

/** The draft as of the latest change: the one still loading, or the one in the address bar. */
function currentDraft(): Draft {
  return readDraft(
    Object.fromEntries(new URLSearchParams(requestedSearch ?? window.location.search)),
  );
}

function goTo(router: ReturnType<typeof useRouter>, draft: Draft) {
  const href = draftHref(draft);
  requestedSearch = href.slice(href.indexOf("?"));
  router.push(href, { scroll: false });
}

/**
 * Forgets the requested draft once the address bar has caught up, or when the back and forward
 * buttons move to another draft. Render it once on the page.
 */
export function DraftSync() {
  const params = useSearchParams();
  useEffect(() => {
    if (`?${params.toString()}` === requestedSearch) requestedSearch = null;
  }, [params]);
  useEffect(() => {
    const forget = () => {
      requestedSearch = null;
    };
    window.addEventListener("popstate", forget);
    return () => window.removeEventListener("popstate", forget);
  }, []);
  return null;
}

const smallButton = "rounded border border-zinc-300 px-2 text-sm leading-6 dark:border-zinc-700";
const field =
  "rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700";

/** "+ add" or "−" for one card on one side. */
export function DraftButton(props: {
  side: "give" | "get";
  card: Omit<DraftCard, "quantity">;
  delta: 1 | -1;
  label: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function change() {
    const draft = currentDraft();
    const next = { ...draft, [props.side]: adjust(draft[props.side], props.card, props.delta) };
    startTransition(() => goTo(router, next));
  }
  return (
    <button
      type="button"
      onClick={change}
      disabled={pending}
      aria-label={props.label}
      className={smallButton}
    >
      {props.children}
    </button>
  );
}

type TextKey = "giveMoney" | "getMoney" | "mine" | "theirs";

/** A one-field form (money or a search) that changes just that part of the draft. */
export function DraftTextForm(props: {
  name: TextKey;
  label: string;
  defaultValue: string;
  placeholder: string;
  button: string;
  prefix?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function submit(formData: FormData) {
    const next = { ...currentDraft(), [props.name]: String(formData.get(props.name) ?? "").trim() };
    startTransition(() => goTo(router, next));
  }
  return (
    <form action={submit} className="flex items-center gap-2">
      <label className="flex flex-1 items-center gap-1 text-sm">
        {props.prefix}
        <input
          name={props.name}
          defaultValue={props.defaultValue}
          placeholder={props.placeholder}
          aria-label={props.label}
          className={`${field} flex-1`}
        />
      </label>
      <button type="submit" disabled={pending} className={field}>
        {props.button}
      </button>
    </form>
  );
}

/** Sends the draft exactly as it is in the address bar when you press the button. */
export function ProposeForm(props: { isCounter: boolean }) {
  function submit(formData: FormData) {
    const href = draftHref(currentDraft());
    const params = new URLSearchParams(href.slice(href.indexOf("?")));
    for (const [key, value] of params) {
      if (key !== "mine" && key !== "theirs" && key !== "error") formData.set(key, value);
    }
    return proposeTradeAction(formData);
  }
  return (
    <form action={submit} className="flex flex-col gap-2">
      <textarea
        name="message"
        rows={2}
        maxLength={300}
        placeholder="A message (optional)"
        aria-label="Message"
        className={field}
      />
      <div>
        <button
          type="submit"
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          {props.isCounter ? "Send counter-offer" : "Propose trade"}
        </button>
      </div>
    </form>
  );
}
