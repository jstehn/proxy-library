"use client";

import { useState, useSyncExternalStore } from "react";
import {
  type NavigatorWithInstall,
  getPwaInstallServerSnapshot,
  getPwaInstallSnapshot,
  refreshPwaInstallState,
  subscribePwaInstall,
  takeDeferredInstallPrompt,
} from "./pwa-install-store";

type InstallAppButtonProps = {
  /** "section" renders the full /account block; "menu" renders a compact item for PhoneMenu. */
  variant?: "section" | "menu";
};

/** Progressive-enhancement install trigger shown only when the browser supports installing. */
export function InstallAppButton({ variant = "section" }: InstallAppButtonProps) {
  const { canInstall, supportsWebInstall } = useSyncExternalStore(
    subscribePwaInstall,
    getPwaInstallSnapshot,
    getPwaInstallServerSnapshot,
  );
  const [isInstalling, setIsInstalling] = useState(false);
  const [installedViaWebInstall, setInstalledViaWebInstall] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  const showButton = canInstall && !installedViaWebInstall;
  const showSection = showButton || statusMessage !== "";

  async function handleInstallClick() {
    if (isInstalling) return;
    setIsInstalling(true);

    try {
      const nav = navigator as NavigatorWithInstall;
      if (supportsWebInstall && typeof nav.install === "function") {
        await nav.install();
        setStatusMessage("The app was installed or opened.");
        setInstalledViaWebInstall(true);
      } else {
        const promptEvent = takeDeferredInstallPrompt();
        if (!promptEvent) return;
        await promptEvent.prompt();
        const { outcome } = await promptEvent.userChoice;
        setStatusMessage(
          outcome === "accepted" ? "The app was installed." : "Installation canceled.",
        );
        refreshPwaInstallState();
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "AbortError") {
        setStatusMessage("Installation was canceled or could not complete.");
      } else {
        setStatusMessage("Installation could not start.");
        console.error(error);
      }
    } finally {
      setIsInstalling(false);
    }
  }

  if (variant === "menu") {
    if (!showSection) return null;
    return (
      <div className="border-border-subtle flex flex-col gap-1 border-t pt-1.5">
        {showButton && (
          <button
            type="button"
            aria-disabled={isInstalling ? "true" : undefined}
            onClick={handleInstallClick}
            className="w-full rounded px-2 py-1.5 text-left font-medium hover:bg-zinc-100 aria-disabled:opacity-60 dark:hover:bg-zinc-800"
          >
            Install app
          </button>
        )}
        {statusMessage !== "" && (
          <p role="status" className="text-muted px-2 text-xs">
            {statusMessage}
          </p>
        )}
      </div>
    );
  }

  return (
    <section hidden={!showSection} className="flex flex-col gap-2">
      <h2 className="font-medium">Install app</h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Add Proxy Library to your device for a standalone app window.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          hidden={!showButton}
          aria-disabled={isInstalling ? "true" : undefined}
          onClick={handleInstallClick}
          className="w-fit rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 aria-disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Install Proxy Library
        </button>
        <p role="status" className="text-sm text-zinc-600 dark:text-zinc-400">
          {statusMessage}
        </p>
      </div>
    </section>
  );
}
