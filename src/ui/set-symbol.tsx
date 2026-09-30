// Set symbols come from the Keyrune icon font (MTGJSON's `keyruneCode` matches its class names).
// The stylesheet is loaded once from a CDN; React places the <link> in the page's <head>.
import { KEYRUNE_CODES } from "./keyrune-codes";

// Keep keyrune-codes.ts in step with this version.
const KEYRUNE_CSS = "https://cdn.jsdelivr.net/npm/keyrune@3.19.0/css/keyrune.min.css";

export function KeyruneStylesheet() {
  return <link rel="stylesheet" href={KEYRUNE_CSS} precedence="default" />;
}

/** The Keyrune code to draw: the set's own, else the fallback's, else null (none has a symbol). */
export function symbolCodeFor(keyruneCode: string, fallbackCode: string | null): string | null {
  const own = keyruneCode.toLowerCase();
  const fallback = fallbackCode?.toLowerCase() ?? null;
  if (KEYRUNE_CODES.has(own)) return own;
  if (fallback !== null && KEYRUNE_CODES.has(fallback)) return fallback;
  return null;
}

/**
 * A set's symbol. Keyrune lags behind new sets (it had no symbol for Reality Fracture Commander
 * when it was added), so a missing symbol falls back to `fallbackCode` (a Commander set's main
 * set), and then to the set's code in a small badge: never nothing.
 */
export function SetSymbol(props: {
  keyruneCode: string;
  fallbackCode?: string | null;
  className?: string;
}) {
  const code = symbolCodeFor(props.keyruneCode, props.fallbackCode ?? null);
  if (code === null) {
    return (
      <span
        aria-hidden="true"
        className={`inline-flex items-center justify-center rounded border border-current px-1 text-[0.5em] leading-tight font-semibold tracking-wide ${props.className ?? ""}`}
      >
        {props.keyruneCode.toUpperCase()}
      </span>
    );
  }
  return <i aria-hidden="true" className={`ss ss-${code} ss-fw ${props.className ?? ""}`} />;
}
