"use client";

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export interface NavigatorWithInstall extends Navigator {
  install?: () => Promise<void>;
  standalone?: boolean;
}

export interface PwaInstallSnapshot {
  canInstall: boolean;
  supportsWebInstall: boolean;
  isStandalone: boolean;
}

const SERVER_SNAPSHOT: PwaInstallSnapshot = {
  canInstall: false,
  supportsWebInstall: false,
  isStandalone: false,
};

let deferredInstallPrompt: BeforeInstallPromptEvent | undefined;
let cachedSnapshot: PwaInstallSnapshot = SERVER_SNAPSHOT;
const listeners = new Set<() => void>();

function readSnapshot(): PwaInstallSnapshot {
  if (typeof window === "undefined") return SERVER_SNAPSHOT;

  const nav = navigator as NavigatorWithInstall;
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
  const supportsWebInstall = typeof nav.install === "function";
  const canInstall = !isStandalone && (supportsWebInstall || deferredInstallPrompt !== undefined);

  if (
    cachedSnapshot.canInstall === canInstall &&
    cachedSnapshot.supportsWebInstall === supportsWebInstall &&
    cachedSnapshot.isStandalone === isStandalone
  ) {
    return cachedSnapshot;
  }

  cachedSnapshot = { canInstall, supportsWebInstall, isStandalone };
  return cachedSnapshot;
}

function notifyListeners(): void {
  readSnapshot();
  for (const listener of listeners) {
    listener();
  }
}

export function subscribePwaInstall(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPwaInstallSnapshot(): PwaInstallSnapshot {
  return readSnapshot();
}

export function getPwaInstallServerSnapshot(): PwaInstallSnapshot {
  return SERVER_SNAPSHOT;
}

export function setDeferredInstallPrompt(event: BeforeInstallPromptEvent | undefined): void {
  deferredInstallPrompt = event;
  notifyListeners();
}

export function takeDeferredInstallPrompt(): BeforeInstallPromptEvent | undefined {
  const promptEvent = deferredInstallPrompt;
  deferredInstallPrompt = undefined;
  notifyListeners();
  return promptEvent;
}

export function refreshPwaInstallState(): void {
  notifyListeners();
}
