// The regex-count ratchet (doc 66, P11). Card rules read oracle text with regexes spread over many
// files; P12 to P14 move them into recognizers (`catalog/domain/features/recognizers/`). This counts
// what is left: every regex literal (`/…/`) and every `new RegExp(` in the production code of the
// folders that hold card rules, not counting the recognizers, tests or `testing/` folders.
// `--update` lowers docs/refactor/regex-baseline.txt to today's count and never raises it.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const FOLDERS = [
  "src/modules/decks/domain",
  "src/shared/card-search",
  "src/modules/drafts/domain",
  "src/modules/catalog/domain",
];
const RECOGNIZERS = "src/modules/catalog/domain/features/recognizers/";
/** Files in those folders that parse something other than card text (the lint rule skips them too). */
const NOT_CARD_TEXT = [
  "src/modules/catalog/domain/comprehensive-rules.ts",
  "src/modules/catalog/domain/edhrec.ts",
  "src/modules/catalog/domain/wpn.ts",
];
const BASELINE_PATH = "docs/refactor/regex-baseline.txt";

/** The production files to count: not tests, not `testing/` folders, not the recognizers. */
function filesToCount(projectRoot: string): string[] {
  const found: string[] = [];
  function walk(folder: string): void {
    for (const entry of readdirSync(join(projectRoot, folder), { withFileTypes: true })) {
      const path = `${folder}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name !== "testing") walk(path);
      } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        if (!path.startsWith(RECOGNIZERS) && !NOT_CARD_TEXT.includes(path)) found.push(path);
      }
    }
  }
  for (const folder of FOLDERS) walk(folder);
  return found;
}

/** How many regex literals and `new RegExp(` calls the source text has. */
export function countRegexes(source: string): number {
  let count = 0;
  function visit(node: ts.Node): void {
    if (ts.isRegularExpressionLiteral(node)) count += 1;
    if (ts.isNewExpression(node) && node.expression.getText() === "RegExp") count += 1;
    ts.forEachChild(node, visit);
  }
  visit(ts.createSourceFile("file.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX));
  return count;
}

function main(): void {
  const projectRoot = process.cwd();
  const count = filesToCount(projectRoot).reduce(
    (total, path) => total + countRegexes(readFileSync(join(projectRoot, path), "utf8")),
    0,
  );
  const baselinePath = join(projectRoot, BASELINE_PATH);
  const baseline = existsSync(baselinePath)
    ? Number(readFileSync(baselinePath, "utf8").trim())
    : Infinity;

  if (process.argv.includes("--update")) {
    if (count < baseline) {
      writeFileSync(baselinePath, `${count}\n`);
      console.log(`Regex baseline lowered from ${baseline} to ${count}.`);
    } else {
      console.log(`Regex baseline stays at ${baseline} (today: ${count}).`);
    }
    return;
  }
  console.log(`Regexes in card-rule code: ${count} (baseline ${baseline})`);
  if (count > baseline) {
    console.error("More regexes than the baseline: write a recognizer instead (doc 66).");
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith("regex-count.ts")) main();
