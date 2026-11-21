// The size report (docs/archive/refactor/README.md, "File size"). `pnpm sizes` lists source files over 500
// lines and fails when one isn't in scripts/dev/baselines/oversize-allowlist.txt. It also prints the
// totals that docs/archive/refactor/STATUS.md tracks. Test files are reported but never fail the check.
//
// It is also a ratchet: the production code lines (no blanks or comments; no tests, `testing/`
// folders or fixtures) must not exceed scripts/dev/baselines/sizes-baseline.txt. `--update` lowers the
// baseline to today's count and never raises it.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const LINE_LIMIT = 500;
const INDEX_LIMIT = 150;
const ROOTS = ["src", "worker", "scripts", "tests"];
const PRODUCTION_ROOTS = ["src", "worker", "scripts"];
const ALLOWLIST_PATH = "scripts/dev/baselines/oversize-allowlist.txt";
const BASELINE_PATH = "scripts/dev/baselines/sizes-baseline.txt";

export type SourceFile = {
  path: string;
  lines: number;
  codeLines: number;
  isTest: boolean;
  /** Helpers for tests that aren't tests themselves: `testing/` and `fixtures/` folders. */
  isTestSupport: boolean;
};

const IGNORED_FOLDERS = new Set(["node_modules", ".next", ".dev"]);

function isTestFile(path: string): boolean {
  return /\.(test|spec)\.tsx?$/.test(path) || path.startsWith("tests/");
}

function isTestSupportFile(path: string): boolean {
  return !isTestFile(path) && /(^|\/)(testing|fixtures)\//.test(path);
}

/** Production code: not a test, not test support, and under a production root. */
export function isProductionFile(file: SourceFile): boolean {
  return (
    !file.isTest &&
    !file.isTestSupport &&
    PRODUCTION_ROOTS.some((root) => file.path.startsWith(`${root}/`))
  );
}

/** The sum of code lines in the production files: the number the ratchet watches. */
export function countProductionCodeLines(files: readonly SourceFile[]): number {
  return files.filter(isProductionFile).reduce((total, file) => total + file.codeLines, 0);
}

export type BaselineVerdict =
  { kind: "ok" } | { kind: "lower"; difference: number } | { kind: "over"; difference: number };

/** Compares today's count with the baseline. A missing baseline (Infinity) is always "lower". */
export function compareToBaseline(count: number, baseline: number): BaselineVerdict {
  if (count > baseline) return { kind: "over", difference: count - baseline };
  if (count < baseline) return { kind: "lower", difference: baseline - count };
  return { kind: "ok" };
}

/** What `--update` writes: the lower of the two numbers, never a higher one. */
export function nextBaseline(count: number, baseline: number): number {
  return Math.min(count, baseline);
}

/** Lines that are neither blank nor only a comment: the part of a file that is code. */
export function countCodeLines(text: string): number {
  let inBlockComment = false;
  let count = 0;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (inBlockComment) {
      if (trimmed.includes("*/")) inBlockComment = false;
    } else if (trimmed === "" || trimmed.startsWith("//")) {
      continue;
    } else if (trimmed.startsWith("/*")) {
      inBlockComment = !trimmed.includes("*/");
    } else {
      count += 1;
    }
  }
  return count;
}

/** Every `.ts` / `.tsx` file under the roots, with its line count. */
function readFiles(projectRoot: string): SourceFile[] {
  const files: SourceFile[] = [];
  function walk(folder: string): void {
    for (const entry of readdirSync(join(projectRoot, folder), { withFileTypes: true })) {
      const path = `${folder}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!IGNORED_FOLDERS.has(entry.name)) walk(path);
      } else if (/\.tsx?$/.test(entry.name)) {
        const text = readFileSync(join(projectRoot, path), "utf8");
        const lines = text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
        files.push({
          path,
          lines,
          codeLines: countCodeLines(text),
          isTest: isTestFile(path),
          isTestSupport: isTestSupportFile(path),
        });
      }
    }
  }
  for (const root of ROOTS) if (existsSync(join(projectRoot, root))) walk(root);
  return files;
}

/** The allowlist's paths (each line is `path  # reason`; a reason is required). */
export function parseAllowlist(text: string): { allowed: Set<string>; missingReasons: string[] } {
  const allowed = new Set<string>();
  const missingReasons: string[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const [path, ...reason] = trimmed.split("#");
    allowed.add((path ?? "").trim());
    if (reason.join("#").trim() === "") missingReasons.push((path ?? "").trim());
  }
  return { allowed, missingReasons };
}

/** Source files over the limit that aren't allowed to be. */
export function findOffenders(
  files: readonly SourceFile[],
  allowed: ReadonlySet<string>,
): SourceFile[] {
  return files.filter((file) => !file.isTest && file.lines > LINE_LIMIT && !allowed.has(file.path));
}

function sum(files: readonly SourceFile[]): number {
  return files.reduce((total, file) => total + file.lines, 0);
}

/** The folders holding the most source files directly, as [folder, count]. */
function biggestFolders(files: readonly SourceFile[], count: number): [string, number][] {
  const counts = new Map<string, number>();
  for (const file of files)
    counts.set(dirname(file.path), (counts.get(dirname(file.path)) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, count);
}

/** How many times `getContainer()` appears in `src/app`. */
function countContainerCalls(projectRoot: string, files: readonly SourceFile[]): number {
  let total = 0;
  for (const file of files) {
    if (!file.path.startsWith("src/app/") || file.isTest) continue;
    const text = readFileSync(join(projectRoot, file.path), "utf8");
    total += text.split("getContainer()").length - 1;
  }
  return total;
}

function main(): void {
  const projectRoot = process.cwd();
  const files = readFiles(projectRoot);
  const production = files.filter(isProductionFile);
  const support = files.filter((file) => file.isTestSupport);
  const source = files.filter((file) => !file.isTest && !file.isTestSupport);
  const tests = files.filter((file) => file.isTest);
  const productionCodeLines = countProductionCodeLines(files);
  const baselinePath = join(projectRoot, BASELINE_PATH);
  const baseline = existsSync(baselinePath)
    ? Number(readFileSync(baselinePath, "utf8").trim())
    : Infinity;

  if (process.argv.includes("--update")) {
    if (productionCodeLines < baseline || baseline === Infinity) {
      writeFileSync(baselinePath, `${nextBaseline(productionCodeLines, baseline)}\n`);
      console.log(`Size baseline lowered from ${baseline} to ${productionCodeLines}.`);
    } else if (productionCodeLines > baseline) {
      console.error(
        `Refusing to raise the size baseline: ${productionCodeLines} is above ${baseline}. Only the owner may edit it by hand.`,
      );
      process.exitCode = 1;
    } else {
      console.log(`Size baseline stays at ${baseline}.`);
    }
    return;
  }

  const allowlistText = existsSync(join(projectRoot, ALLOWLIST_PATH))
    ? readFileSync(join(projectRoot, ALLOWLIST_PATH), "utf8")
    : "";
  const { allowed, missingReasons } = parseAllowlist(allowlistText);

  const over = source.filter((file) => file.lines > LINE_LIMIT).sort((a, b) => b.lines - a.lines);
  const offenders = findOffenders(files, allowed);
  const stale = [...allowed].filter((path) => !over.some((file) => file.path === path));

  const codeOf = (list: readonly SourceFile[]) =>
    list.reduce((total, file) => total + file.codeLines, 0);
  console.log(`Source lines: ${sum(source)} in ${source.length} files`);
  console.log(
    `Production code lines: ${productionCodeLines} in ${production.length} files (baseline ${baseline})`,
  );
  console.log(`Test support: ${codeOf(support)} code lines in ${support.length} files`);
  console.log(
    `Tests:        ${codeOf(tests)} code lines (${sum(tests)} lines) in ${tests.length} files`,
  );
  console.log(
    `Source files over ${LINE_LIMIT} lines: ${over.length} (${over.length - offenders.length} allowed)`,
  );
  for (const file of over) {
    console.log(
      `  ${String(file.lines).padStart(5)}  ${file.path}${allowed.has(file.path) ? "" : "   <-- NOT ALLOWED"}`,
    );
  }
  const bigTests = tests
    .filter((file) => file.lines > LINE_LIMIT)
    .sort((a, b) => b.lines - a.lines);
  console.log(`Test files over ${LINE_LIMIT} lines (information only): ${bigTests.length}`);
  for (const file of bigTests) console.log(`  ${String(file.lines).padStart(5)}  ${file.path}`);

  console.log("Folders with the most source files:");
  for (const [folder, count] of biggestFolders(source, 10))
    console.log(`  ${String(count).padStart(3)}  ${folder}`);

  const wideIndexes = source.filter(
    (file) => file.path.endsWith("/index.ts") && file.lines > INDEX_LIMIT,
  );
  console.log(`index.ts files over ${INDEX_LIMIT} lines: ${wideIndexes.length}`);
  for (const file of wideIndexes) console.log(`  ${String(file.lines).padStart(5)}  ${file.path}`);

  console.log(`getContainer() calls in src/app: ${countContainerCalls(projectRoot, files)}`);

  for (const path of stale) {
    console.log(
      `Note: ${path} is on the allowlist but no longer over ${LINE_LIMIT} lines (remove it).`,
    );
  }
  if (missingReasons.length > 0) {
    console.error(`Allowlist entries without a "# reason": ${missingReasons.join(", ")}`);
    process.exitCode = 1;
  }
  const verdict = compareToBaseline(productionCodeLines, baseline);
  if (verdict.kind === "over") {
    console.error(
      `\nProduction code is ${verdict.difference} lines above the baseline (${productionCodeLines} > ${baseline}). Remove code, or ask the owner to approve the growth.`,
    );
    process.exitCode = 1;
  } else if (verdict.kind === "lower") {
    console.log(`${verdict.difference} lines below the baseline: run \`pnpm sizes --update\`.`);
  }
  if (offenders.length > 0) {
    console.error(
      `\n${offenders.length} file(s) over ${LINE_LIMIT} lines are not on ${relative(projectRoot, join(projectRoot, ALLOWLIST_PATH))}. Split them, or add them with a reason.`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && /sizes\.ts$/.test(process.argv[1])) main();
