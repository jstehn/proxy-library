"use client";
import { useState } from "react";
import {
  cardsToPrint,
  DEFAULT_PROXY_OPTIONS,
  GAPS_IN_MILLIMETERS,
  proxyPages,
  pageList,
  proxySummary,
  type ProxyLine,
  type ProxyOptions,
} from "@/modules/decks/client";

// The proxy options (design doc 14, section 3), with what they'll produce shown as you choose.

type Choice<Key extends keyof ProxyOptions> = Readonly<{
  value: ProxyOptions[Key];
  label: string;
}>;

type Question<Key extends keyof ProxyOptions> = Readonly<{
  key: Key;
  title: string;
  choices: readonly Choice<Key>[];
  help?: string;
}>;

const PAPER: Question<"paper"> = {
  key: "paper",
  title: "Paper",
  choices: [
    { value: "letter", label: "US Letter" },
    { value: "a4", label: "A4" },
  ],
};
const BASIC_LANDS: Question<"basicLands"> = {
  key: "basicLands",
  title: "Basic lands",
  choices: [
    { value: "skip", label: "Skip them" },
    { value: "include", label: "Include them" },
  ],
};
const BACK_FACES: Question<"backFaces"> = {
  key: "backFaces",
  title: "Double-faced cards",
  choices: [
    { value: "pages", label: "Back faces on their own pages" },
    { value: "skip", label: "Front faces only" },
  ],
  help: "Each page of fronts is followed by a page of their backs, mirrored: print those two pages two-sided (flip on the long edge; on the short edge for sideways pages), or print the backs as stickers.",
};
const CARDS: Question<"cards"> = {
  key: "cards",
  title: "Which cards",
  choices: [
    { value: "all", label: "The whole deck" },
    { value: "noSideboard", label: "Without the sideboard" },
  ],
};
const COPIES: Question<"copies"> = {
  key: "copies",
  title: "Copies",
  choices: [
    { value: "deck", label: "As many as the deck has" },
    { value: "one", label: "One of each" },
  ],
};
const GAP: Question<"gapMillimeters"> = {
  key: "gapMillimeters",
  title: "Gap between cards",
  choices: GAPS_IN_MILLIMETERS.map((gap) => ({ value: gap, label: `${gap} mm` })),
};
const GUIDES: Question<"guides"> = {
  key: "guides",
  title: "Cut guides",
  choices: [
    { value: "corners", label: "Corner marks" },
    { value: "lines", label: "Full lines" },
    { value: "none", label: "None" },
  ],
};
const BLEED: Question<"bleed"> = {
  key: "bleed",
  title: "Bleed",
  choices: [
    { value: "none", label: "None" },
    { value: "eighthInch", label: "1/8 inch (3 mm)" },
  ],
  help: "Extra image around each card, so a slightly-off cut still shows no white edge. Fewer cards fit on a page.",
};

const FOILS: Question<"foils"> = {
  key: "foils",
  title: "Foils",
  choices: [
    { value: "mixed", label: "With the other cards" },
    { value: "ownPages", label: "On their own pages" },
  ],
  help: "For printing foils on foil paper: they come after everything else, so the foil paper goes in once. A card is foil when the deck's copy is (foil or etched).",
};

const QUESTIONS = [
  PAPER,
  BASIC_LANDS,
  BACK_FACES,
  FOILS,
  CARDS,
  COPIES,
  GAP,
  GUIDES,
  BLEED,
] as const;

export function ProxyForm(props: { deckId: number; lines: readonly ProxyLine[] }) {
  const [options, setOptions] = useState<ProxyOptions>(DEFAULT_PROXY_OPTIONS);
  const summary = proxySummary(props.lines, options);
  const firstPage = proxyPages(cardsToPrint(props.lines, options), options)[0];
  const query = new URLSearchParams(
    Object.entries(options).map(([key, value]) => [key, String(value)]),
  );

  function choose<Key extends keyof ProxyOptions>(key: Key, value: ProxyOptions[Key]) {
    setOptions((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="flex flex-col gap-6 md:flex-row-reverse md:items-start">
      <aside className="flex flex-col gap-3 md:sticky md:top-4 md:w-64">
        {firstPage && (
          <svg
            viewBox={`0 0 ${firstPage.width} ${firstPage.height}`}
            role="img"
            aria-label="The first page"
            className="w-full rounded border border-zinc-300 bg-white shadow dark:border-zinc-700"
          >
            {/* PDF measures from the bottom; SVG from the top. */}
            <g transform={`translate(0 ${firstPage.height}) scale(1 -1)`}>
              {firstPage.guides.map((guide, index) => (
                <line
                  key={index}
                  x1={guide.from.x}
                  y1={guide.from.y}
                  x2={guide.to.x}
                  y2={guide.to.y}
                  stroke="black"
                  strokeWidth={1}
                />
              ))}
              {firstPage.placements.map((placement, index) => (
                <g key={index}>
                  <rect {...placement.image} fill="#3f3f46" />
                  <rect {...placement.card} fill="#71717a" />
                </g>
              ))}
            </g>
          </svg>
        )}
        <p className="text-sm" aria-live="polite">
          {summary.cards === 0
            ? "Nothing to print with these options."
            : `${summary.cards} ${summary.cards === 1 ? "card" : "cards"} on ${summary.pages} ${summary.pages === 1 ? "page" : "pages"}, ${summary.perPage} to a page${summary.sideways ? " (sideways)" : ""}.`}
          {summary.twoSidedPages.length > 0 &&
            ` Double-faced cards are on ${pageList(summary.twoSidedPages)}: print those two-sided.`}
          {options.foils === "ownPages" &&
            summary.cards > 0 &&
            (summary.foilPages.length > 0
              ? ` Foils are on ${pageList(summary.foilPages)}: print those on foil paper.`
              : " This deck has no foils.")}
        </p>
        <a
          href={`/decks/${props.deckId}/proxies.pdf?${query}`}
          aria-disabled={summary.cards === 0}
          className={`rounded-md bg-zinc-900 px-4 py-2 text-center text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900 ${summary.cards === 0 ? "pointer-events-none opacity-40" : ""}`}
        >
          Download PDF
        </a>
        <p className="text-xs text-zinc-500">
          Print at &quot;actual size&quot; (100%), not &quot;fit to page&quot;. Big decks take a few
          seconds: each image is fetched once and then kept.
        </p>
      </aside>

      <form className="flex flex-1 flex-col gap-5" onSubmit={(event) => event.preventDefault()}>
        {QUESTIONS.map((question) => (
          <OptionGroup
            key={question.key}
            question={question}
            selected={options[question.key]}
            onChoose={(value) => choose(question.key, value)}
          />
        ))}
      </form>
    </div>
  );
}

function OptionGroup<Key extends keyof ProxyOptions>(props: {
  question: Question<Key>;
  selected: ProxyOptions[Key];
  onChoose: (value: ProxyOptions[Key]) => void;
}) {
  const { question } = props;
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 text-sm font-medium">{question.title}</legend>
      <div className="flex flex-wrap gap-2">
        {question.choices.map((choice) => (
          <label
            key={String(choice.value)}
            className={`cursor-pointer rounded-md border px-3 py-1.5 text-sm ${props.selected === choice.value ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900" : "border-zinc-300 dark:border-zinc-700"}`}
          >
            <input
              type="radio"
              name={question.key}
              className="sr-only"
              checked={props.selected === choice.value}
              onChange={() => props.onChoose(choice.value)}
            />
            {choice.label}
          </label>
        ))}
      </div>
      {question.help && <p className="text-xs text-zinc-500">{question.help}</p>}
    </fieldset>
  );
}
