import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { previewLines, proxyDeck, proxyOptionsFrom } from "../print/proxy-lines";

/** The deck's proxies as a PDF, with the options in the address (design doc 14, section 3). */
export async function GET(request: Request, context: RouteContext<"/decks/[id]/proxies.pdf">) {
  const actor = await requireActor();
  const { id } = await context.params;
  const deck = await proxyDeck(actor.userId, Number(id));
  if (deck === null) return new Response("Not found", { status: 404 });

  const parameters = new URL(request.url).searchParams;
  const options = proxyOptionsFrom(parameters);
  // A preview (design doc 22) is the first card the options print, once, shown in the browser.
  const preview = parameters.get("preview") === "1";
  const lines = preview ? previewLines(deck.lines, options) : deck.lines;
  const pdf = await getContainer().proxySheet(lines, options);
  // A file name without characters that upset browsers or file systems.
  const fileName = `${deck.view.deck.name.replace(/[^\w -]+/g, "").trim() || "deck"} proxies.pdf`;
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${preview ? "inline" : "attachment"}; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
