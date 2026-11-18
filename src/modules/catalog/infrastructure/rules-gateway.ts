import type { Fetch } from "@/shared/http";
import type { ComprehensiveRulesGateway } from "../application/ports";

const WIZARDS_RULES_PAGE = "https://magic.wizards.com/en/rules";
const TXT_LINK_RE = /https:\/\/media\.wizards\.com\/[^"'\s<>]*MagicCompRules[^"'\s<>]*\.txt/i;

export function httpComprehensiveRulesGateway(fetchFn: Fetch): ComprehensiveRulesGateway {
  return {
    async fetchLatestRulesText() {
      const pageRes = await fetchFn(WIZARDS_RULES_PAGE);
      if (!pageRes.ok) {
        throw new Error(`Failed to fetch Wizards rules page: ${pageRes.status}`);
      }
      const html = await pageRes.text();
      const match = html.match(TXT_LINK_RE);
      if (!match) {
        throw new Error("Could not locate MagicCompRules .txt link on Wizards rules page.");
      }
      const sourceUrl = match[0].replace(/&amp;/g, "&");
      const txtRes = await fetchFn(sourceUrl);
      if (!txtRes.ok) {
        throw new Error(`Failed to download Comprehensive Rules (${txtRes.status}): ${sourceUrl}`);
      }
      const text = await txtRes.text();
      return { sourceUrl, text };
    },
  };
}
