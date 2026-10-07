"use client";
import { useState } from "react";
import {
  completeLines,
  progressFraction,
  progressLabel,
  type ProxyProgress,
  type ProxyStreamEvent,
} from "@/modules/decks/client";

// The "Download PDF" button with a progress bar (design doc 22, section 16). It asks for the PDF
// as a stream of progress lines, shows them, and saves the PDF that comes last. The link still
// works on its own (right-click, "Save link as"), without the bar.

type DownloadState =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "working"; progress: ProxyProgress | null }>
  | Readonly<{ kind: "failed"; message: string }>;

/** The PDF's bytes from base64 (the stream is text). */
function bytesFrom(base64: string): Uint8Array<ArrayBuffer> {
  const text = atob(base64);
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index++) bytes[index] = text.charCodeAt(index);
  return bytes;
}

/** Hands the browser a file to save, as if a download link had been clicked. */
function save(bytes: Uint8Array<ArrayBuffer>, fileName: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  // Give the browser a moment to start the download before the address goes away.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function DownloadButton(props: { href: string; disabled: boolean }) {
  const [state, setState] = useState<DownloadState>({ kind: "idle" });
  const working = state.kind === "working";

  async function download() {
    setState({ kind: "working", progress: null });
    try {
      // This app's own route (same site), not an outside service, so ADR 0007's gateway rule
      // doesn't apply.
      // eslint-disable-next-line no-restricted-globals -- see above
      const response = await fetch(`${props.href}&progress=1`);
      if (!response.ok || response.body === null) throw new Error(`HTTP ${response.status}`);
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let pending = "";
      for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
        const { lines, rest } = completeLines(pending, chunk.value);
        pending = rest;
        for (const line of lines) {
          const event = JSON.parse(line) as ProxyStreamEvent;
          if (event.kind === "progress") setState({ kind: "working", progress: event.progress });
          if (event.kind === "error") throw new Error(event.message);
          if (event.kind === "pdf") {
            save(bytesFrom(event.base64), event.fileName);
            setState({ kind: "idle" });
            return;
          }
        }
      }
      throw new Error("The download stopped before the PDF arrived. Try again.");
    } catch (error) {
      setState({
        kind: "failed",
        message: error instanceof Error ? error.message : "The PDF couldn't be made.",
      });
    }
  }

  const fraction =
    state.kind === "working" && state.progress ? progressFraction(state.progress) : 0;
  return (
    <div className="flex flex-col gap-2">
      <a
        href={props.href}
        onClick={(event) => {
          event.preventDefault();
          if (!working) void download();
        }}
        aria-disabled={props.disabled || working}
        className={`rounded-md bg-zinc-900 px-4 py-2 text-center text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900 ${props.disabled || working ? "pointer-events-none opacity-40" : ""}`}
      >
        {working ? "Making the PDF…" : "Download PDF"}
      </a>
      {working && (
        <div className="flex flex-col gap-1" aria-live="polite">
          <div
            role="progressbar"
            aria-label="Making the PDF"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(fraction * 100)}
            className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
          >
            <div
              className="h-full rounded-full bg-zinc-900 transition-[width] duration-200 dark:bg-zinc-100"
              style={{ width: `${fraction * 100}%` }}
            />
          </div>
          <p className="text-xs text-zinc-500">
            {state.progress ? progressLabel(state.progress) : "Starting…"}
          </p>
        </div>
      )}
      {state.kind === "failed" && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {state.message}
        </p>
      )}
    </div>
  );
}
