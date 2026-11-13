"use client";
import { useState } from "react";
import {
  cardsToPrint,
  DEFAULT_PROXY_OPTIONS,
  GAPS_IN_MILLIMETERS,
  proxyPages,
  pageList,
  proxySummary,
  sheetCards,
  TOKEN_COPIES,
  type ProxyLine,
  type ProxyOptions,
  type TokenLine,
} from "@/modules/decks/client";
import { DownloadButton } from "./download-button";
import { TokenList } from "./token-section";

// The proxy options (design doc 14, section 3, the playtest style of design doc 22 and the
// tokens of design doc 25), with what they'll produce shown as you choose.

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

const STYLE: Question<"style"> = {
  key: "style",
  title: "Card style",
  choices: [
    { value: "scan", label: "Card scans" },
    { value: "playtest", label: "Playtest (low ink)" },
  ],
  help: "Playtest cards are drawn from each card's text on white: name, cost, art, type, rules and stats, with stripes in the card's colours. They use far less ink than scans.",
};
const ART_FILTER: Question<"artFilter"> = {
  key: "artFilter",
  title: "Art",
  choices: [
    { value: "color", label: "Full colour" },
    { value: "grayscale", label: "Black and white" },
    { value: "edges", label: "Edges only (Sobel)" },
    { value: "none", label: "No art" },
  ],
  help: "Edges only prints the art's outlines, like a pencil sketch: the least ink of the three.",
};
const STRIPES: Question<"stripes"> = {
  key: "stripes",
  title: "Colour stripes",
  choices: [
    { value: "on", label: "On" },
    { value: "off", label: "Off (plain white)" },
  ],
  help: "Light stripes in the card's colours behind its frame; lands show the colours of mana they make, colourless cards grey.",
};

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
/** Asked when the deck counts real copies (design doc 16). */
const REAL_CARDS: Question<"realCards"> = {
  key: "realCards",
  title: "Cards you own for real",
  choices: [
    { value: "leaveOut", label: "Leave them out" },
    { value: "print", label: "Print them too" },
  ],
  help: "A deck needing 4 copies of a card when you own 2 for real prints 2, counting every printing of it.",
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
    { value: "fillGap", label: "Fill the gap" },
  ],
  help: "Each card's image (or a playtest card's stripes) reaches into the gap around it, meeting its neighbour's in the middle, so a slightly-off cut shows no white edge. The gap sets how much: a 2 mm gap gives 1 mm on each side. Same number of cards per page.",
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

const TOKEN_COPIES_QUESTION: Question<"tokenCopies"> = {
  key: "tokenCopies",
  title: "Copies of each token",
  choices: TOKEN_COPIES.map((copies) => ({
    value: copies,
    label: copies === 0 ? "None" : `${copies}`,
  })),
  help: "Tokens print after the cards, in the same style. Cards you leave out as real still get their tokens.",
};

/** Only asked for playtest cards. */
const PLAYTEST_QUESTIONS = [ART_FILTER, STRIPES] as const;

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

type ProxyFormProps = Readonly<{
  deckId: number;
  lines: readonly ProxyLine[];
  tokens: readonly TokenLine[];
}>;

export function ProxyForm(props: ProxyFormProps) {
  const [options, setOptions] = useState<ProxyOptions>(DEFAULT_PROXY_OPTIONS);
  // Your token choices are saved as you make them; this is the fresh list the server sent back.
  const [tokens, setTokens] = useState<readonly TokenLine[]>(props.tokens);
  const copies = sheetCards(props.lines, tokens, options);
  const summary = proxySummary(copies, options);
  const cardCount = cardsToPrint(props.lines, options).length;
  const tokenCount = copies.length - cardCount;
  const hasRealCards = props.lines.some((line) => line.ownedReal > 0);
  const firstPage = proxyPages(copies, options)[0];
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
            : `${countWords(cardCount, tokenCount)} on ${summary.pages} ${summary.pages === 1 ? "page" : "pages"}, ${summary.perPage} to a page${summary.sideways ? " (sideways)" : ""}.`}
          {summary.twoSidedPages.length > 0 &&
            ` Double-faced cards are on ${pageList(summary.twoSidedPages)}: print those two-sided.`}
          {options.foils === "ownPages" &&
            summary.cards > 0 &&
            (summary.foilPages.length > 0
              ? ` Foils are on ${pageList(summary.foilPages)}: print those on foil paper.`
              : " This deck has no foils.")}
          {options.bleed === "fillGap" &&
            options.gapMillimeters === 0 &&
            " With no gap between cards, bleed has nothing to fill: choose a gap."}
        </p>
        <DownloadButton
          href={`/decks/${props.deckId}/proxies.pdf?${query}`}
          disabled={summary.cards === 0}
        />
        {options.style === "playtest" && summary.cards > 0 && (
          <a
            href={`/decks/${props.deckId}/proxies.pdf?${query}&preview=1`}
            target="_blank"
            rel="noopener"
            className="rounded-md border border-zinc-300 px-4 py-2 text-center text-sm font-medium dark:border-zinc-700"
          >
            {cardCount === 0 ? "Preview one token" : "Preview one card"}
          </a>
        )}
        <p className="text-muted text-xs">
          Print at &quot;actual size&quot; (100%), not &quot;fit to page&quot;. Big decks take a few
          seconds the first time: each image is fetched once and then kept.
        </p>
      </aside>

      <form className="flex flex-1 flex-col gap-5" onSubmit={(event) => event.preventDefault()}>
        <OptionGroup
          question={STYLE}
          selected={options.style}
          onChoose={(value) => choose("style", value)}
        />
        {options.style === "playtest" && (
          <div className="flex flex-col gap-5 border-l-2 border-zinc-300 pl-4 dark:border-zinc-700">
            {PLAYTEST_QUESTIONS.map((question) => (
              <OptionGroup
                key={question.key}
                question={question}
                selected={options[question.key]}
                onChoose={(value) => choose(question.key, value)}
              />
            ))}
          </div>
        )}
        {hasRealCards && (
          <OptionGroup
            question={REAL_CARDS}
            selected={options.realCards}
            onChoose={(value) => choose("realCards", value)}
          />
        )}
        {QUESTIONS.map((question) => (
          <OptionGroup
            key={question.key}
            question={question}
            selected={options[question.key]}
            onChoose={(value) => choose(question.key, value)}
          />
        ))}
        <section aria-labelledby="tokens-heading" className="flex flex-col gap-3">
          <h2 id="tokens-heading" className="text-lg font-semibold">
            Tokens
          </h2>
          {tokens.length > 0 && (
            <OptionGroup
              question={TOKEN_COPIES_QUESTION}
              selected={options.tokenCopies}
              onChoose={(value) => choose("tokenCopies", value)}
            />
          )}
          <TokenList deckId={props.deckId} tokens={tokens} onTokensChange={setTokens} />
        </section>
      </form>
    </div>
  );
}

/** "12 cards and 6 tokens", "1 card", "4 tokens". */
function countWords(cards: number, tokens: number): string {
  const parts = [
    cards > 0 ? `${cards} ${cards === 1 ? "card" : "cards"}` : null,
    tokens > 0 ? `${tokens} ${tokens === 1 ? "token" : "tokens"}` : null,
  ].filter((part) => part !== null);
  return parts.join(" and ");
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
      {question.help && <p className="text-muted text-xs">{question.help}</p>}
    </fieldset>
  );
}
