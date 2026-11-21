// The design-doc citation check (P22). Code comments, ADRs, lessons and docs cite design docs
// ("design doc 28", "doc 28 §3", `docs/design/28-llm-tools.md`). Moving a doc to
// `docs/design/archive/` must never leave a citation pointing at nothing. For every number cited,
// `docs/design/NN-*.md` or `docs/design/archive/NN-*.md` must exist; every cited path must exist.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const FOLDERS = ["src", "worker", "tests", "scripts", "docs", "lessons"];
const SINGLE_FILES = ["README.md", "CONTRIBUTING.md", "CLAUDE.md"];
const EXTENSIONS = /\.(ts|tsx|md|mjs|sh|json|yml|yaml)$/;
const SKIPPED_FOLDERS = new Set(["node_modules", ".next", ".dev", "screenshots", "fixtures"]);
/** This script's own files quote example citations. */
const SKIPPED_FILES = new Set([
  "scripts/dev/check-doc-citations.ts",
  "scripts/dev/check-doc-citations.test.ts",
]);

/** Numbers that are cited but never had a design doc. */
export const MISSING_ON_PURPOSE: Record<string, string> = {
  "50": "the number was skipped when the docs were numbered; no doc 50 exists",
  "62": "skipped number; no doc 62 exists",
  "63": "skipped number; no doc 63 exists",
};

export type Citation = { line: number; text: string; number: string; path?: string };

const DESIGN_DOC_PHRASE = /\bdesign docs? (\d{2})\b/gi;
const BARE_DOC_PHRASE = /\bdocs? (\d{2})\b/gi;
const LINK_PATTERN = /(?:docs\/)?design\/((?:archive\/)?)(\d{2})-[a-z0-9-]+\.md/gi;

/**
 * Every citation in one file: "design doc NN", "doc NN" (only when the file mentions `design`),
 * and `design/NN-name.md` links (with the path, so it can be checked as a path).
 */
export function findCitations(source: string): Citation[] {
  const mentionsDesign = /design/i.test(source);
  const found: Citation[] = [];
  source.split("\n").forEach((text, index) => {
    const line = index + 1;
    const taken = new Set<number>();
    for (const match of text.matchAll(LINK_PATTERN)) {
      found.push({ line, text, number: match[2], path: match[0].replace(/^docs\//, "") });
      for (let at = match.index; at < match.index + match[0].length; at++) taken.add(at);
    }
    for (const match of text.matchAll(DESIGN_DOC_PHRASE)) {
      found.push({ line, text, number: match[1] });
      taken.add(match.index);
    }
    if (mentionsDesign) {
      for (const match of text.matchAll(BARE_DOC_PHRASE)) {
        const insideLink = taken.has(match.index);
        const alreadyCounted = /\bdesign $/i.test(
          text.slice(Math.max(0, match.index - 7), match.index),
        );
        if (!insideLink && !alreadyCounted) found.push({ line, text, number: match[1] });
      }
    }
  });
  return found;
}

/** The two-digit numbers that have a doc, in `docs/design/` or `docs/design/archive/`. */
function numbersWithDocs(projectRoot: string): Set<string> {
  const numbers = new Set<string>();
  for (const folder of ["docs/design", "docs/design/archive"]) {
    const full = join(projectRoot, folder);
    if (!existsSync(full)) continue;
    for (const name of readdirSync(full)) {
      const match = /^(\d{2})-.*\.md$/.exec(name);
      if (match) numbers.add(match[1]);
    }
  }
  return numbers;
}

/** The problems with one citation, or an empty list. */
export function problemsWith(
  citation: Citation,
  numbers: Set<string>,
  pathExists: (path: string) => boolean,
): string[] {
  if (citation.path !== undefined) {
    return pathExists(`docs/${citation.path}`) ? [] : [`${citation.path} does not exist`];
  }
  if (numbers.has(citation.number) || citation.number in MISSING_ON_PURPOSE) return [];
  return [`no design doc ${citation.number}`];
}

function filesToScan(projectRoot: string): string[] {
  const found = SINGLE_FILES.filter((name) => existsSync(join(projectRoot, name)));
  function walk(folder: string): void {
    for (const entry of readdirSync(join(projectRoot, folder), { withFileTypes: true })) {
      const path = `${folder}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIPPED_FOLDERS.has(entry.name)) walk(path);
      } else if (EXTENSIONS.test(entry.name) && !SKIPPED_FILES.has(path)) {
        found.push(path);
      }
    }
  }
  for (const folder of FOLDERS) if (existsSync(join(projectRoot, folder))) walk(folder);
  return found;
}

function main(): void {
  const projectRoot = process.cwd();
  const numbers = numbersWithDocs(projectRoot);
  const pathExists = (path: string): boolean => existsSync(join(projectRoot, path));
  let total = 0;
  const failures: string[] = [];
  for (const path of filesToScan(projectRoot)) {
    for (const citation of findCitations(readFileSync(join(projectRoot, path), "utf8"))) {
      total += 1;
      for (const problem of problemsWith(citation, numbers, pathExists)) {
        failures.push(`${path}:${citation.line}: ${problem}`);
      }
    }
  }
  if (failures.length > 0) {
    console.error(failures.join("\n"));
    console.error(`doc citations: ${failures.length} broken of ${total}`);
    process.exit(1);
  }
  console.log(`doc citations: ${total} checked, none broken`);
}

if (process.argv[1]?.endsWith("check-doc-citations.ts")) main();
