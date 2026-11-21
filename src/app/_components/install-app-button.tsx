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

const INSTALL_BUTTON =
  "border-line hover:bg-surface-raised w-fit rounded-md border px-3 py-1.5 text-sm font-medium aria-disabled:opacity-60";

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
            className="hover:bg-surface-raised w-full rounded px-2 py-1.5 text-left font-medium aria-disabled:opacity-60"
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
      <p className="text-muted text-sm">
        Add Proxy Library to your device for a standalone app window.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          hidden={!showButton}
          aria-disabled={isInstalling ? "true" : undefined}
          onClick={handleInstallClick}
          className={INSTALL_BUTTON}
        >
          Install Proxy Library
        </button>
        <p role="status" className="text-muted text-sm">
          {statusMessage}
        </p>
      </div>
    </section>
  );
}
