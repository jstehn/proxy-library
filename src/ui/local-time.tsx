"use client";
import { useSyncExternalStore } from "react";

// Shows a moment in the viewer's own time zone. The server doesn't know the viewer's time zone,
// so the first render (on the server) shows UTC, and the browser then switches to local time.

const noSubscription = () => () => {};

/** true in the browser, false while rendering on the server. */
function useIsBrowser(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}

export function LocalTime(props: { iso: string; withTime?: boolean }) {
  const isBrowser = useIsBrowser();
  const date = new Date(props.iso);
  const options: Intl.DateTimeFormatOptions = props.withTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { dateStyle: "medium" };

  const text = isBrowser
    ? new Intl.DateTimeFormat(undefined, options).format(date)
    : `${new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(date)} UTC`;

  return <time dateTime={props.iso}>{text}</time>;
}
