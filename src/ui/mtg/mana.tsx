// Mana symbols like {2}{W}{U/B}{T} drawn with the Mana icon font (by the Keyrune author).
const MANA_CSS = "https://cdn.jsdelivr.net/npm/mana-font@1.18.0/css/mana.min.css";

export function ManaStylesheet() {
  return <link rel="stylesheet" href={MANA_CSS} precedence="default" />;
}

export type ManaToken = { kind: "text"; text: string } | { kind: "symbol"; symbol: string };

/** Splits "Pay {2}{W}: draw." into text and symbol pieces. Pure, so it's easy to test. */
export function manaTokens(text: string): ManaToken[] {
  const tokens: ManaToken[] = [];
  const pattern = /\{([^}]+)\}/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) tokens.push({ kind: "text", text: text.slice(last, match.index) });
    tokens.push({ kind: "symbol", symbol: match[1] });
    last = match.index + match[0].length;
  }
  if (last < text.length) tokens.push({ kind: "text", text: text.slice(last) });
  return tokens;
}

/** The Mana font's class for a symbol: "W" → "w", "T" → "tap", "W/U" → "wu", "2/W" → "2w". */
export function manaClass(symbol: string): string {
  const special: Record<string, string> = { T: "tap", Q: "untap", "∞": "infinity", "½": "1-2" };
  return special[symbol] ?? symbol.toLowerCase().replace("/", "");
}

/** Text with its {…} mana symbols drawn as icons. */
export function ManaText(props: { text: string }) {
  return (
    <>
      {manaTokens(props.text).map((token, index) =>
        token.kind === "text" ? (
          <span key={index}>{token.text}</span>
        ) : (
          <i
            key={index}
            title={`{${token.symbol}}`}
            className={`ms ms-${manaClass(token.symbol)} ms-cost ${token.symbol.includes("/") ? "ms-split" : ""}`}
          />
        ),
      )}
    </>
  );
}
