// Import cycles (ADR 0009): fails if any of the project's files import each other in a loop.
// It replaces ESLint's import/no-cycle, which re-parsed the whole import graph for every file and
// took over three minutes of every `pnpm check`. This reads each file once with the TypeScript
// compiler (already a dependency), resolves imports the way tsconfig does (so "@/…" works), and
// searches the graph once: a second or two.
//
// What counts: imports that run. `import type` / `export type` (and imports whose every name is
// `type`) are erased when compiled, so they can't make a cycle at runtime. Packages in
// node_modules are left out: only our own files can form a cycle we can fix.
import { dirname, relative } from "node:path";
import ts from "typescript";

/** Each file and the files it imports at runtime. */
export type ImportGraph = ReadonlyMap<string, readonly string[]>;

/**
 * Every import cycle in the graph, each as the files in order (the first file imports the second,
 * …, the last imports the first). Each loop is reported once, whichever file it's found from.
 */
export function findCycles(graph: ImportGraph): string[][] {
  const cycles: string[][] = [];
  const seenCycles = new Set<string>();
  const finished = new Set<string>();
  const path: string[] = [];
  const onPath = new Set<string>();

  function visit(file: string): void {
    path.push(file);
    onPath.add(file);
    for (const imported of graph.get(file) ?? []) {
      if (onPath.has(imported)) {
        const cycle = path.slice(path.indexOf(imported));
        const key = [...cycle].sort().join("\n");
        if (!seenCycles.has(key)) {
          seenCycles.add(key);
          cycles.push(cycle);
        }
      } else if (!finished.has(imported)) {
        visit(imported);
      }
    }
    path.pop();
    onPath.delete(file);
    finished.add(file);
  }

  for (const file of [...graph.keys()].sort()) {
    if (!finished.has(file)) visit(file);
  }
  return cycles;
}

/** Whether an import or export statement only brings in types (so it's erased when compiled). */
function isTypeOnly(statement: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
  if (ts.isImportDeclaration(statement)) {
    const clause = statement.importClause;
    if (clause === undefined) return false; // `import "./styles"` runs the file
    if (clause.isTypeOnly) return true;
    const bindings = clause.namedBindings;
    return (
      clause.name === undefined &&
      bindings !== undefined &&
      ts.isNamedImports(bindings) &&
      bindings.elements.length > 0 &&
      bindings.elements.every((element) => element.isTypeOnly)
    );
  }
  if (statement.isTypeOnly) return true;
  const clause = statement.exportClause;
  return (
    clause !== undefined &&
    ts.isNamedExports(clause) &&
    clause.elements.length > 0 &&
    clause.elements.every((element) => element.isTypeOnly)
  );
}

/** The project's files (from tsconfig.json) and the runtime imports between them. */
function readGraph(projectRoot: string): ImportGraph {
  const configPath = ts.findConfigFile(projectRoot, ts.sys.fileExists, "tsconfig.json");
  if (configPath === undefined) throw new Error("tsconfig.json not found");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath));
  // Next.js's generated route types aren't ours to fix.
  const files = parsed.fileNames.filter((file) => !/[\\/]\.next[^\\/]*[\\/]/.test(file));
  const ourFiles = new Set(files);

  const graph = new Map<string, string[]>();
  for (const file of files) {
    const source = ts.createSourceFile(file, ts.sys.readFile(file) ?? "", ts.ScriptTarget.Latest);
    const imports: string[] = [];
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
      const specifier = statement.moduleSpecifier;
      if (specifier === undefined || !ts.isStringLiteral(specifier)) continue; // `export { a }`
      if (isTypeOnly(statement)) continue;
      const resolved = ts.resolveModuleName(specifier.text, file, parsed.options, ts.sys);
      const target = resolved.resolvedModule;
      if (target === undefined || target.isExternalLibraryImport) continue;
      if (ourFiles.has(target.resolvedFileName)) imports.push(target.resolvedFileName);
    }
    graph.set(file, imports);
  }
  return graph;
}

function main(): void {
  const projectRoot = process.cwd();
  const graph = readGraph(projectRoot);
  const cycles = findCycles(graph);
  if (cycles.length === 0) {
    console.log(`No import cycles in ${graph.size} files.`);
    return;
  }
  console.error(`${cycles.length} import ${cycles.length === 1 ? "cycle" : "cycles"}:`);
  for (const cycle of cycles) {
    const names = cycle.map((file) => relative(projectRoot, file));
    console.error(`  ${[...names, names[0]].join(" → ")}`);
  }
  process.exitCode = 1;
}

// Run only as a command (`pnpm lint:cycles`), not when the test imports findCycles.
if (process.argv[1] !== undefined && /check-cycles\.ts$/.test(process.argv[1])) main();
