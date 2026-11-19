// The size report (docs/refactor/README.md, "File size"). `pnpm sizes` lists source files over 500
// lines and fails when one isn't in docs/refactor/oversize-allowlist.txt. It also prints the
// totals that docs/refactor/STATUS.md tracks. Test files are reported but never fail the check.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const LINE_LIMIT = 500;
const INDEX_LIMIT = 150;
const ROOTS = ["src", "worker", "scripts", "tests"];
const ALLOWLIST_PATH = "docs/refactor/oversize-allowlist.txt";

export type SourceFile = { path: string; lines: number; isTest: boolean };

const IGNORED_FOLDERS = new Set(["node_modules", ".next", ".dev", "fixtures"]);

function isTestFile(path: string): boolean {
  return /\.(test|spec)\.tsx?$/.test(path) || path.startsWith("tests/");
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
        files.push({ path, lines, isTest: isTestFile(path) });
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
  const source = files.filter((file) => !file.isTest);
  const tests = files.filter((file) => file.isTest);

  const allowlistText = existsSync(join(projectRoot, ALLOWLIST_PATH))
    ? readFileSync(join(projectRoot, ALLOWLIST_PATH), "utf8")
    : "";
  const { allowed, missingReasons } = parseAllowlist(allowlistText);

  const over = source.filter((file) => file.lines > LINE_LIMIT).sort((a, b) => b.lines - a.lines);
  const offenders = findOffenders(files, allowed);
  const stale = [...allowed].filter((path) => !over.some((file) => file.path === path));

  console.log(`Source lines: ${sum(source)} in ${source.length} files`);
  console.log(`Test lines:   ${sum(tests)} in ${tests.length} files`);
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
  if (offenders.length > 0) {
    console.error(
      `\n${offenders.length} file(s) over ${LINE_LIMIT} lines are not on ${relative(projectRoot, join(projectRoot, ALLOWLIST_PATH))}. Split them, or add them with a reason.`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && /sizes\.ts$/.test(process.argv[1])) main();
