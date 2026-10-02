"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// Keeps a draft page up to date (ADR 0018). The server streams "version N" whenever the draft
// changes; when N is newer than what the page shows, the page reloads its server data. The
// stream never carries cards: the page's own query decides what this player may see.

type Connection = "connecting" | "live" | "polling";

const POLL_MILLISECONDS = 5000;

export function LiveUpdates(props: { draftId: number; version: number }) {
  const router = useRouter();
  const [connection, setConnection] = useState<Connection>("connecting");
  // A ref, not state: the event handler below must see the newest version without the
  // effect re-running (which would close and reopen the stream on every refresh).
  const shownVersion = useRef(props.version);

  useEffect(() => {
    shownVersion.current = props.version;
  }, [props.version]);

  useEffect(() => {
    let poller: ReturnType<typeof setInterval> | null = null;
    let failures = 0;
    const source = new EventSource(`/api/drafts/${props.draftId}/events`);

    source.addEventListener("open", () => {
      failures = 0;
      setConnection("live");
    });
    source.addEventListener("version", (event) => {
      const data = (event as MessageEvent<string>).data;
      // "refresh" means the server may have missed changes: reload whatever the version.
      if (data === "refresh" || Number(data) > shownVersion.current) router.refresh();
    });
    source.addEventListener("error", () => {
      // EventSource reconnects by itself. If it keeps failing (a proxy that buffers streams,
      // say), fall back to asking for the page every few seconds.
      failures += 1;
      if (failures >= 3 && poller === null) {
        source.close();
        setConnection("polling");
        poller = setInterval(() => router.refresh(), POLL_MILLISECONDS);
      }
    });

    // The cleanup runs when the player leaves the page: the server then marks them away.
    return () => {
      source.close();
      if (poller !== null) clearInterval(poller);
    };
  }, [props.draftId, router]);

  const label = {
    connecting: "connecting…",
    live: "live",
    polling: "updating every few seconds",
  }[connection];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500" aria-live="polite">
      <span
        aria-hidden
        className={`h-2 w-2 rounded-full ${connection === "live" ? "bg-green-500" : "bg-amber-500"}`}
      />
      {label}
    </span>
  );
}
