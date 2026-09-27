// Set symbols come from the Keyrune icon font (MTGJSON's `keyruneCode` matches its class names).
// The stylesheet is loaded once from a CDN; React places the <link> in the page's <head>.
const KEYRUNE_CSS = "https://cdn.jsdelivr.net/npm/keyrune@3.19.0/css/keyrune.min.css";

export function KeyruneStylesheet() {
  return <link rel="stylesheet" href={KEYRUNE_CSS} precedence="default" />;
}

export function SetSymbol(props: { keyruneCode: string; className?: string }) {
  return (
    <i
      aria-hidden="true"
      className={`ss ss-${props.keyruneCode.toLowerCase()} ss-fw ${props.className ?? ""}`}
    />
  );
}
