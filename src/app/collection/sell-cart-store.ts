"use client";
import { useSyncExternalStore } from "react";
import type { SellCartItem } from "./actions";

const STORAGE_KEY = "proxy-library:sell-cart:v1";
const EMPTY: readonly SellCartItem[] = [];

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedItems: readonly SellCartItem[] = EMPTY;

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): readonly SellCartItem[] {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (raw === cachedRaw) return cachedItems;
    cachedRaw = raw;
    if (!raw) {
      cachedItems = EMPTY;
    } else {
      const parsed = JSON.parse(raw);
      cachedItems = Array.isArray(parsed) ? (parsed as SellCartItem[]) : EMPTY;
    }
    return cachedItems;
  } catch {
    return EMPTY;
  }
}

function getServerSnapshot(): readonly SellCartItem[] {
  return EMPTY;
}

export function setSellCart(updater: (previous: readonly SellCartItem[]) => SellCartItem[]) {
  const next = updater(getSnapshot());
  if (typeof window !== "undefined") {
    try {
      if (next.length === 0) {
        window.sessionStorage.removeItem(STORAGE_KEY);
        cachedRaw = null;
        cachedItems = EMPTY;
      } else {
        const serialized = JSON.stringify(next);
        window.sessionStorage.setItem(STORAGE_KEY, serialized);
        cachedRaw = serialized;
        cachedItems = next;
      }
    } catch {
      cachedItems = next;
    }
  }
  notify();
}

export function useSellCart(): readonly SellCartItem[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
