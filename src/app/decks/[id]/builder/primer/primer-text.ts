// The deck primer's text (design doc 61): a small, safe Markdown subset (## headings, - lists,
// **bold**, [[Card Name]] links) read into blocks the page renders itself, never as HTML, and
// the "Card — reason" lines the profile editor uses. Pure.

/** A run of text inside a block: plain, bold, or a [[Card Name]] link. */
export type PrimerInline =
  | Readonly<{ kind: "text"; text: string }>
  | Readonly<{ kind: "bold"; text: string }>
  | Readonly<{ kind: "card"; name: string }>;

export type PrimerBlock =
  | Readonly<{ kind: "heading"; level: 2 | 3; content: readonly PrimerInline[] }>
  | Readonly<{ kind: "list"; items: readonly (readonly PrimerInline[])[] }>
  | Readonly<{ kind: "paragraph"; content: readonly PrimerInline[] }>;

/** The sections a primer starts with when the player asks for them. */
const SUGGESTED_SECTIONS = [
  "Plan",
  "How it wins",
  "Key cards",
  "Mulligan",
  "Turns 1–3",
  "Turns 4–6",
  "Late game",
  "Watch out for",
] as const;

/** Text split into plain, **bold** and [[Card Name]] runs. */
export function parseInline(text: string): PrimerInline[] {
  const runs: PrimerInline[] = [];
  const pattern = /\[\[([^\]]+)\]\]|\*\*([^*]+)\*\*/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > last) runs.push({ kind: "text", text: text.slice(last, start) });
    if (match[1] !== undefined) runs.push({ kind: "card", name: match[1].trim() });
    else if (match[2] !== undefined) runs.push({ kind: "bold", text: match[2] });
    last = start + match[0].length;
  }
  if (last < text.length) runs.push({ kind: "text", text: text.slice(last) });
  return runs;
}

/** The primer's Markdown read into headings, lists and paragraphs. */
export function parsePrimer(markdown: string): PrimerBlock[] {
  const blocks: PrimerBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: "paragraph", content: parseInline(paragraph.join(" ")) });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list.length > 0) {
      blocks.push({ kind: "list", items: list.map(parseInline) });
      list = [];
    }
  };
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = /^(#{2,3})\s+(.+)$/.exec(line);
    const item = /^[-*]\s+(.+)$/.exec(line);
    if (line === "") {
      flushParagraph();
      flushList();
    } else if (heading !== null) {
      flushParagraph();
      flushList();
      blocks.push({
        kind: "heading",
        level: heading[1] === "##" ? 2 : 3,
        content: parseInline(heading[2] ?? ""),
      });
    } else if (item !== null) {
      flushParagraph();
      list.push(item[1] ?? "");
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}

/** Every card name the primer links to, once each, in order. */
export function linkedCardNames(markdown: string): string[] {
  const names = new Set<string>();
  for (const match of markdown.matchAll(/\[\[([^\]]+)\]\]/g)) {
    if (match[1] !== undefined) names.add(match[1].trim());
  }
  return [...names];
}

/** The primer with a "## Section" heading added for each suggested section it doesn't have. */
export function withSuggestedSections(markdown: string): string {
  const present = new Set(
    [...markdown.matchAll(/^##\s+(.+)$/gm)].map((match) => (match[1] ?? "").trim().toLowerCase()),
  );
  const missing = SUGGESTED_SECTIONS.filter((section) => !present.has(section.toLowerCase()));
  if (missing.length === 0) return markdown;
  const additions = missing.map((section) => `## ${section}\n\n`).join("");
  const base = markdown.trimEnd();
  return base === "" ? additions.trimEnd() + "\n" : `${base}\n\n${additions.trimEnd()}\n`;
}

export type NamedLine = Readonly<{ cardName: string; reason: string }>;

/** "Card Name — reason" lines (also " - " or ": "); a line with no reason keeps an empty one. */
export function parseNamedLines(text: string): NamedLine[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => {
      const separator = /\s+[—–-]\s+|:\s+/.exec(line);
      if (separator === null) return { cardName: line, reason: "" };
      return {
        cardName: line.slice(0, separator.index).trim(),
        reason: line.slice(separator.index + separator[0].length).trim(),
      };
    });
}

/** Named lines written back as text, one "Card Name — reason" per line. */
export function formatNamedLines(lines: readonly NamedLine[]): string {
  return lines
    .map((line) => (line.reason === "" ? line.cardName : `${line.cardName} — ${line.reason}`))
    .join("\n");
}

/** Non-empty trimmed lines of a textarea. */
export function nonEmptyLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}
