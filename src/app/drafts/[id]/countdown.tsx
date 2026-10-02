"use client";
import { useEffect, useState } from "react";
import { clockText } from "../labels";

// A pick timer counting down. The browser's own clock may be wrong by minutes, so the page
// passes the server's time, and this only measures how long it has been showing since, with
// `performance.now()` (a stopwatch, not a clock). The server still decides when time is up.

export function Countdown(props: { deadline: string; serverNow: string; className?: string }) {
  const total = (new Date(props.deadline).getTime() - new Date(props.serverNow).getTime()) / 1000;
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const shownAt = performance.now();
    const timer = setInterval(() => setElapsed((performance.now() - shownAt) / 1000), 250);
    return () => clearInterval(timer);
  }, [props.deadline, props.serverNow]);

  const left = total - elapsed;
  const urgent = left <= 10;
  return (
    <span
      className={`font-mono tabular-nums ${urgent ? "text-red-600 dark:text-red-400" : ""} ${props.className ?? ""}`}
      title="Time left for this pick"
    >
      {left <= 0 ? "time's up" : clockText(left)}
    </span>
  );
}
