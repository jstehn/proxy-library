// Pure parser for Wizards of the Coast's official Comprehensive Rules .txt (design doc 60).

export type RuleKind = "section" | "rule" | "subrule" | "glossary";

export type ParsedRule = Readonly<{
  ruleNumber: string;
  kind: RuleKind;
  section: string;
  parentNumber: string | null;
  title: string | null;
  text: string;
}>;

export type ParsedComprehensiveRules = Readonly<{
  version: string;
  rules: readonly ParsedRule[];
}>;

const MONTHS: Record<string, string> = {
  january: "01",
  february: "02",
  march: "03",
  april: "04",
  may: "05",
  june: "06",
  july: "07",
  august: "08",
  september: "09",
  october: "10",
  november: "11",
  december: "12",
};

export function extractCrVersion(rawText: string): string {
  const match = rawText.match(/effective as of\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/i);
  if (!match) return "unknown";
  const month = MONTHS[match[1].toLowerCase()];
  if (!month) return "unknown";
  const day = match[2].padStart(2, "0");
  return `${match[3]}-${month}-${day}`;
}

const SECTION_RE = /^(\d{3})\.\s+(.+)$/;
const SUBRULE_RE = /^(\d{3}\.\d+)([a-z]+)\s+(.+)$/;
const RULE_RE = /^(\d{3}\.\d+)\.\s+(.+)$/;

function glossaryKey(term: string): string {
  const slug = term
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `glossary:${slug || "term"}`;
}

export function parseComprehensiveRules(rawText: string): ParsedComprehensiveRules {
  const normalized = rawText.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const version = extractCrVersion(normalized);
  const lines = normalized.split("\n");

  const byNumber = new Map<string, ParsedRule>();
  let inBody = false;
  let inGlossary = false;
  let currentSection = "General";
  let activeKey: string | null = null;
  let glossaryTerm: string | null = null;
  let glossaryLines: string[] = [];

  function flushGlossary() {
    if (glossaryTerm && glossaryLines.length > 0) {
      const key = glossaryKey(glossaryTerm);
      byNumber.set(key, {
        ruleNumber: key,
        kind: "glossary",
        section: "Glossary",
        parentNumber: null,
        title: glossaryTerm,
        text: glossaryLines.join(" ").replace(/\s+/g, " ").trim(),
      });
    }
    glossaryTerm = null;
    glossaryLines = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (inBody && line === "Glossary") {
      inGlossary = true;
      activeKey = null;
      continue;
    }

    if (inGlossary) {
      if (line === "Credits") {
        flushGlossary();
        break;
      }
      if (line === "") {
        flushGlossary();
        continue;
      }
      if (!glossaryTerm) {
        glossaryTerm = line;
      } else {
        glossaryLines.push(line);
      }
      continue;
    }

    if (line === "") {
      activeKey = null;
      continue;
    }

    const subruleMatch = line.match(SUBRULE_RE);
    if (subruleMatch) {
      inBody = true;
      const [, parent, suffix, text] = subruleMatch;
      const ruleNumber = `${parent}${suffix}`;
      byNumber.set(ruleNumber, {
        ruleNumber,
        kind: "subrule",
        section: currentSection,
        parentNumber: parent,
        title: null,
        text: text.trim(),
      });
      activeKey = ruleNumber;
      continue;
    }

    const ruleMatch = line.match(RULE_RE);
    if (ruleMatch) {
      inBody = true;
      const [, ruleNumber, text] = ruleMatch;
      const sectionNum = ruleNumber.split(".")[0];
      byNumber.set(ruleNumber, {
        ruleNumber,
        kind: "rule",
        section: currentSection,
        parentNumber: sectionNum,
        title: text.length <= 60 && !text.endsWith(".") ? text : null,
        text: text.trim(),
      });
      activeKey = ruleNumber;
      continue;
    }

    const sectionMatch = line.match(SECTION_RE);
    if (sectionMatch) {
      const [, secNum, title] = sectionMatch;
      currentSection = `${secNum}. ${title.trim()}`;
      if (inBody) {
        byNumber.set(secNum, {
          ruleNumber: secNum,
          kind: "section",
          section: currentSection,
          parentNumber: null,
          title: title.trim(),
          text: currentSection,
        });
      }
      activeKey = null;
      continue;
    }

    // Continuation line (e.g. Example: ... or multi-line rule)
    if (inBody && activeKey) {
      const existing = byNumber.get(activeKey);
      if (existing) {
        byNumber.set(activeKey, {
          ...existing,
          text: `${existing.text}\n${line}`,
        });
      }
    }
  }

  flushGlossary();
  return { version, rules: [...byNumber.values()] };
}

/** Formats a parsed rule for embedding with `bge-small-en-v1.5`. */
export function ruleEmbeddingText(rule: ParsedRule): string {
  const header = rule.title ? `${rule.ruleNumber} ${rule.title}` : rule.ruleNumber;
  return `${rule.section}\n${header}\n${rule.text}`;
}
