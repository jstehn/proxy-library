import { requireActor } from "@/server/session";
import { BORDERS, FRAME_VERSIONS, IS_VALUES, MAX_PATTERN_LENGTH } from "@/shared/card-search";

// Every keyword the card search understands (design docs 14 and 15), modeled on Scryfall's
// syntax guide. Linked from every card search box.

type Row = Readonly<{ write: string; finds: string; example: string }>;

const BASICS: readonly Row[] = [
  { write: "words", finds: "names containing all of them", example: "goblin king" },
  { write: '!"name"', finds: "exactly that name", example: '!"Lightning Bolt"' },
  { write: "-term", finds: "everything but that", example: "-t:land" },
  { write: "or", finds: "either side", example: "t:elf or t:goblin" },
  { write: "( )", finds: "groups terms", example: "(c:r or c:g) mv<=2" },
  { write: '"…"', finds: "a phrase with spaces", example: 'o:"draw a card"' },
  {
    write: "/…/",
    finds: `a regular expression (names, o:, t:, a:; up to ${MAX_PATTERN_LENGTH} characters)`,
    example: "o:/draw (a|two) cards?/",
  },
];

const KEYWORDS: readonly Row[] = [
  { write: "o: oracle:", finds: "rules text", example: 'o:"enters the battlefield"' },
  { write: "t: type:", finds: "type line", example: "t:legendary t:creature" },
  {
    write: "c: color:",
    finds: "colors: at least these (c:), or =, <=, >=, <, >",
    example: "c:rw  c<=bg",
  },
  {
    write: "id: ci:",
    finds: "color identity, including rules text: within these by default",
    example: "id<=esper",
  },
  { write: "mv cmc", finds: "mana value", example: "mv<=2" },
  { write: "m: mana:", finds: "mana cost symbols", example: "m:{G}{G}" },
  {
    write: "pow tou loy def",
    finds: "power, toughness, loyalty, defense",
    example: "pow>=4 loy>=4",
  },
  {
    write: "kw: keyword:",
    finds: "keyword abilities and actions",
    example: 'kw:flying  kw:"first strike"',
  },
  { write: "r: rarity:", finds: "rarity (c, u, r, m)", example: "r>=rare" },
  { write: "s: set:", finds: "set code", example: "s:blb" },
  { write: "cn: number:", finds: "collector number", example: "s:fdn cn<=100" },
  { write: "a: artist:", finds: "artist", example: 'a:"rebecca guay"' },
  { write: "f: format:", finds: "legal in a format", example: "f:pauper" },
  {
    write: "produces:",
    finds: "mana it can make (W, U, B, R, G, C)",
    example: "produces:g t:artifact",
  },
  { write: "usd", finds: "the cheapest current market price, in dollars", example: "usd<0.50" },
  {
    write: "year date",
    finds: "the set's release year or date",
    example: "year>=2024  date>=2024-08",
  },
  { write: "border:", finds: BORDERS.join(", "), example: "border:borderless" },
  {
    write: "frame:",
    finds: `${FRAME_VERSIONS.join(", ")}, or an effect such as showcase, extendedart, inverted`,
    example: "frame:showcase",
  },
  { write: "own owned", finds: "how many copies you own (any printing)", example: "own=0  own>=4" },
];

const IS_GROUPS = ["finish", "layout", "treatment", "kind"] as const;
const IS_DESCRIPTIONS: Readonly<Record<(typeof IS_GROUPS)[number], string>> = {
  finish:
    "is:foil means: sold in foil (store), this copy is foil (collection), you own a foil (deck builder)",
  layout: "how the card is laid out (dfc is any double-faced card; mdfc is modal)",
  treatment: "special printings",
  kind: "kinds of card (vanilla: a creature with no rules text; bear: a 2-mana 2/2)",
};

function Table(props: { rows: readonly Row[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-zinc-500">
          <tr>
            <th className="py-1 pr-4 font-medium">Write</th>
            <th className="py-1 pr-4 font-medium">Finds</th>
            <th className="py-1 font-medium">Example</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => (
            <tr key={row.write} className="border-t border-zinc-200 align-top dark:border-zinc-800">
              <td className="py-1.5 pr-4 font-mono whitespace-nowrap">{row.write}</td>
              <td className="py-1.5 pr-4">{row.finds}</td>
              <td className="py-1.5 font-mono whitespace-nowrap">{row.example}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function SearchHelpPage() {
  await requireActor();
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-12">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Search help</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Every card search (the singles store, your collection, the deck builder) understands the
          same words, modeled on Scryfall&apos;s. Terms side by side must all match. A part the
          search can&apos;t read is skipped, and a note under the box says which.
        </p>
      </header>
      <section className="flex flex-col gap-2">
        <h2 className="font-medium">Putting a search together</h2>
        <Table rows={BASICS} />
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="font-medium">Keywords</h2>
        <p className="text-sm text-zinc-500">
          Numbers and colors take <code>:</code> <code>=</code> <code>!=</code> <code>&lt;</code>{" "}
          <code>&lt;=</code> <code>&gt;</code> <code>&gt;=</code>.
        </p>
        <Table rows={KEYWORDS} />
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="font-medium">is:</h2>
        <dl className="flex flex-col gap-3 text-sm">
          {IS_GROUPS.map((group) => (
            <div key={group}>
              <dt className="font-mono">
                {IS_VALUES[group].map((value) => `is:${value}`).join("  ")}
              </dt>
              <dd className="text-zinc-500">{IS_DESCRIPTIONS[group]}</dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}
