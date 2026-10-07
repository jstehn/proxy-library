import type { ProxyStreamEvent } from "@/modules/decks";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { previewLines, proxyDeck, proxyOptionsFrom } from "../print/proxy-lines";

/**
 * The deck's proxies as a PDF, with the options in the address (design doc 14, section 3).
 * With `progress=1` the answer is a stream of JSON lines instead (design doc 22, section 16):
 * progress as the images are fetched and the pages drawn, then the PDF itself, so the print page
 * can show a progress bar.
 */
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
  // A file name without characters that upset browsers or file systems.
  const fileName = `${deck.view.deck.name.replace(/[^\w -]+/g, "").trim() || "deck"} proxies.pdf`;
  const { proxySheet } = getContainer();

  if (parameters.get("progress") === "1") {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let open = true;
        function send(event: ProxyStreamEvent) {
          if (!open) return;
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          } catch {
            open = false; // the browser has gone; finish quietly
          }
        }
        try {
          const pdf = await proxySheet(lines, options, (progress) =>
            send({ kind: "progress", progress }),
          );
          send({ kind: "pdf", fileName, base64: Buffer.from(pdf).toString("base64") });
        } catch (error) {
          console.error("proxy PDF failed", error);
          send({ kind: "error", message: "The PDF couldn't be made. Try again in a moment." });
        }
        if (open) controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        // no-transform: compression would hold the lines back until it had enough to squeeze.
        "Cache-Control": "private, no-store, no-transform",
        // Reverse proxies (nginx) pass each line on at once instead of buffering the answer.
        "X-Accel-Buffering": "no",
      },
    });
  }

  const pdf = await proxySheet(lines, options);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${preview ? "inline" : "attachment"}; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
