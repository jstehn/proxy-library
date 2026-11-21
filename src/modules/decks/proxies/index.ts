// What the other areas and the module root use of decks/proxies (ADR 0029).
export * from "./client";
export { makeProxyDeck, type ProxyDeck } from "./application/proxy-deck";
export { makeProxySheets, type ProxySheetInput } from "./application/proxy-sheets";
export { makeTokenChoices } from "./application/token-choices";
export { deckTokenLines, publicDeckTokens, tokenArtOptions } from "./queries/tokens";
