import { DraftId, draftVersion } from "@/modules/drafts";
import { getContainer, getDraftSubscriptions } from "@/server/container";
import { getCurrentActor } from "@/server/session";

// Live updates for one draft, as Server-Sent Events (ADR 0018). The stream says only "the
// draft is now at version N"; the page then reloads its own data. While a seated player's
// stream is open, it also tells the draft they're here (design doc 17, section 7).

const HEARTBEAT_MILLISECONDS = 15_000;

export async function GET(request: Request, context: RouteContext<"/api/drafts/[id]/events">) {
  const actor = await getCurrentActor();
  if (actor === null) return new Response("Sign in first", { status: 401 });
  const raw = Number((await context.params).id);
  if (!Number.isSafeInteger(raw) || raw <= 0) return new Response("Not found", { status: 404 });
  const draftId = DraftId.of(raw);

  const { db, drafts } = getContainer();
  const version = await draftVersion(db, draftId);
  if (version === null) return new Response("Not found", { status: 404 });

  const encoder = new TextEncoder();
  let stop: () => void = () => undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      function send(text: string) {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          stop(); // the browser has gone
        }
      }
      const sendVersion = (next: number | null) =>
        send(`event: version\ndata: ${next ?? "refresh"}\n\n`);

      const unsubscribe = getDraftSubscriptions().subscribe(draftId, sendVersion);
      // "Here" on connect and with every heartbeat; a no-op for players who aren't seated.
      const markHere = (here: boolean) =>
        drafts.markPresence(actor, draftId, here).catch((error: unknown) => {
          console.error("draft presence failed:", error);
        });
      void markHere(true);
      const heartbeat = setInterval(() => {
        send(": still here\n\n"); // a comment line: keeps proxies from closing the stream
        void markHere(true);
      }, HEARTBEAT_MILLISECONDS);

      // Reconnect after 3 seconds if the stream drops, then the version the page should be at:
      // anything that changed between the page loading and this stream opening is caught here.
      send("retry: 3000\n\n");
      sendVersion(version);

      stop = () => {
        if (!open) return;
        open = false;
        clearInterval(heartbeat);
        unsubscribe();
        void markHere(false);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      request.signal.addEventListener("abort", stop);
    },
    cancel() {
      stop();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // tells nginx not to buffer the stream
    },
  });
}
