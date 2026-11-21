// The clone ratchet (docs/archive/refactor/README.md). `pnpm clones` finds runs of 6 normalized lines that
// appear in more than one place and fails when there are more of them than the baseline in
// scripts/dev/baselines/clone-baseline.txt. `--update` lowers the baseline to today's count (never raises).
//
// Normalizing: comments, imports, string and number literals, whitespace and lines holding only
// brackets are dropped or flattened, so two copies that differ in names of strings or numbers still
// match. Runs shorter than 200 characters are skipped (too small to be worth a function).
//
// `--near` is a report only (it reads and writes no baseline and always exits 0): it also flattens
// every identifier to `i` and uses 8-line windows, so copies that only rename things still match.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const RUN_LENGTH = 6;
const NEAR_RUN_LENGTH = 8;
const MINIMUM_CHARACTERS = 200;
const NEAR_MINIMUM_CHARACTERS = 100; // flattened names make lines much shorter
const ROOTS = ["src", "worker", "scripts"];
const BASELINE_PATH = "scripts/dev/baselines/clone-baseline.txt";
const IGNORED_FOLDERS = new Set(["node_modules", ".next", "testing", "fixtures"]);

type NormalizedLine = { text: string; lineNumber: number };
export type CloneMode = "exact" | "near";

const KEYWORDS = new Set(
  (
    "abstract as async await break case catch class const continue default delete do else enum " +
    "export extends false finally for from function if implements import in instanceof interface " +
    "is keyof let new null of private protected public readonly return satisfies static super " +
    "switch this throw true try type typeof undefined var void while yield"
  ).split(" "),
);

/** Replaces every identifier that isn't a keyword with `i`. */
function flattenIdentifiers(line: string): string {
  return line.replace(/[A-Za-z_$][\w$]*/g, (word) => (KEYWORDS.has(word) ? word : "i"));
}

/** The lines of a file that count for clone detection, flattened. */
export function normalize(source: string, mode: CloneMode = "exact"): NormalizedLine[] {
  const withoutBlockComments = source.replace(/\/\*[\s\S]*?\*\//g, (match) =>
    match.replace(/[^\n]/g, ""),
  );
  const result: NormalizedLine[] = [];
  withoutBlockComments.split("\n").forEach((rawLine, index) => {
    let line = rawLine.replace(/\/\/.*$/, "");
    line = line.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '"s"').replace(/\b\d[\d_.]*\b/g, "0");
    if (mode === "near") line = flattenIdentifiers(line);
    line = line.replace(/\s+/g, "");
    if (line === "" || /^[{}()[\];,]+$/.test(line)) return;
    if (/^(import|export\*from|exporttype\{)/.test(line) && /from"s"/.test(line)) return;
    if (/^import"s"/.test(line)) return;
    result.push({ text: line, lineNumber: index + 1 });
  });
  return result;
}

/** Hash → every place a long enough run of lines starts. */
export function findCloneRuns(
  files: ReadonlyMap<string, string>,
  mode: CloneMode = "exact",
): Map<string, string[]> {
  const runs = new Map<string, string[]>();
  const runLength = mode === "near" ? NEAR_RUN_LENGTH : RUN_LENGTH;
  for (const [path, source] of files) {
    const lines = normalize(source, mode);
    for (let start = 0; start + runLength <= lines.length; start++) {
      const window = lines.slice(start, start + runLength);
      const text = window.map((line) => line.text).join("\n");
      if (text.length < (mode === "near" ? NEAR_MINIMUM_CHARACTERS : MINIMUM_CHARACTERS)) continue;
      const places = runs.get(text) ?? [];
      places.push(`${path}:${window[0]?.lineNumber ?? 0}`);
      runs.set(text, places);
    }
  }
  return runs;
}

/** How many distinct runs appear in more than one place. */
export function countClones(
  files: ReadonlyMap<string, string>,
  mode: CloneMode = "exact",
): {
  count: number;
  examples: string[][];
} {
  const examples: string[][] = [];
  for (const places of findCloneRuns(files, mode).values()) {
    if (places.length > 1) examples.push(places);
  }
  return { count: examples.length, examples };
}

function readSourceFiles(projectRoot: string): Map<string, string> {
  const files = new Map<string, string>();
  function walk(folder: string): void {
    for (const entry of readdirSync(join(projectRoot, folder), { withFileTypes: true })) {
      const path = `${folder}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!IGNORED_FOLDERS.has(entry.name)) walk(path);
      } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        files.set(path, readFileSync(join(projectRoot, path), "utf8"));
      }
    }
  }
  for (const root of ROOTS) if (existsSync(join(projectRoot, root))) walk(root);
  return files;
}

function main(): void {
  const projectRoot = process.cwd();
  if (process.argv.includes("--near")) {
    const { count, examples } = countClones(readSourceFiles(projectRoot), "near");
    console.log(`Near-duplicated ${NEAR_RUN_LENGTH}-line runs (names flattened): ${count}`);
    const biggest = [...examples].sort((a, b) => b.length - a.length).slice(0, 20);
    for (const places of biggest)
      console.log(`  ${places.length}x  ${places.slice(0, 4).join("  =  ")}`);
    return;
  }

  const { count, examples } = countClones(readSourceFiles(projectRoot));
  const baselinePath = join(projectRoot, BASELINE_PATH);
  const baseline = existsSync(baselinePath)
    ? Number(readFileSync(baselinePath, "utf8").trim())
    : Infinity;

  if (process.argv.includes("--update")) {
    if (count < baseline) {
      writeFileSync(baselinePath, `${count}\n`);
      console.log(`Clone baseline lowered from ${baseline} to ${count}.`);
    } else {
      console.log(`Clone baseline stays at ${baseline} (today: ${count}); it only goes down.`);
      if (baseline === Infinity) writeFileSync(baselinePath, `${count}\n`);
    }
    return;
  }

  console.log(`Duplicated 6-line runs: ${count} (baseline ${baseline})`);
  if (count > baseline) {
    console.error(`More clones than the baseline allows. Some of the duplicated places:`);
    for (const places of examples.slice(0, 10))
      console.error(`  ${places.slice(0, 3).join("  =  ")}`);
    process.exitCode = 1;
  } else if (count < baseline) {
    console.log("Fewer than the baseline: run `pnpm clones --update` to lower it.");
  }
}

if (process.argv[1] !== undefined && /clones\.ts$/.test(process.argv[1])) main();
