import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Keyrune icon font (https://keyrune.andrewgioia.com) for MTG set symbols on playtest proxies.
// Reads the TTF bytes and CSS glyph map from the installed `keyrune` package so upgrading the
// package automatically picks up new sets.

const KEYRUNE_DIR = join(process.cwd(), "node_modules", "keyrune");
const KEYRUNE_FONT_PATH = join(KEYRUNE_DIR, "fonts", "keyrune.ttf");
const KEYRUNE_CSS_PATH = join(KEYRUNE_DIR, "css", "keyrune.css");

export type KeyruneFont = Readonly<{
  bytes: Uint8Array;
  /** Lowercase Keyrune code (e.g. "blb") -> single-character glyph in keyrune.ttf. */
  glyphs: ReadonlyMap<string, string>;
}>;

/** Parses `.ss-<code>:before { content: "\e9cd"; }` rules from keyrune.css. */
export function parseKeyruneCss(css: string): Map<string, string> {
  const glyphs = new Map<string, string>();
  const pattern = /\.ss-([a-z0-9]+)::?before\s*\{\s*content:\s*"\\([0-9a-fA-F]+)"/g;
  for (let match = pattern.exec(css); match !== null; match = pattern.exec(css)) {
    const code = match[1]?.toLowerCase();
    const hex = match[2];
    if (code === undefined || hex === undefined) continue;
    glyphs.set(code, String.fromCodePoint(Number.parseInt(hex, 16)));
  }
  return glyphs;
}

/** Looks up the Keyrune glyph for a set code, falling back from token/promo codes (e.g. tblb → blb). */
export function keyruneGlyph(glyphs: ReadonlyMap<string, string>, setCode: string): string | null {
  const code = setCode.trim().toLowerCase();
  if (code === "") return null;
  const direct = glyphs.get(code);
  if (direct !== undefined) return direct;
  if (code.length === 4 && (code.startsWith("t") || code.startsWith("p"))) {
    return glyphs.get(code.slice(1)) ?? null;
  }
  return null;
}

let cachedFont: Promise<KeyruneFont> | null = null;

/** Reads and caches the Keyrune TTF bytes and glyph lookup map from node_modules. */
export function readKeyruneFont(): Promise<KeyruneFont> {
  if (cachedFont === null) {
    cachedFont = Promise.all([
      readFile(KEYRUNE_FONT_PATH),
      readFile(KEYRUNE_CSS_PATH, "utf8"),
    ]).then(([fontBuffer, css]) => ({
      bytes: new Uint8Array(fontBuffer),
      glyphs: parseKeyruneCss(css),
    }));
  }
  return cachedFont;
}
