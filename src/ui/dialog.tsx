"use client";
// The one modal dialog, built on the native <dialog> element. `showModal()` makes the browser
// trap focus inside it, close it on Escape and make the page behind it inert, so none of that is
// written here. The one thing added: focus goes back to the element that opened it.
import { useEffect, useRef } from "react";

type DialogProps = {
  open: boolean;
  /** Called when the dialog closes itself (Escape) or the player clicks outside it. */
  onClose: () => void;
  title: string;
  children: React.ReactNode;
};

const SURFACE = "bg-background text-foreground border-line rounded-lg border shadow-xl";

export function Dialog(props: DialogProps) {
  const { open, onClose, title, children } = props;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(
    function syncWithNativeDialog() {
      const dialog = dialogRef.current;
      if (!dialog) return;
      if (open && !dialog.open) {
        openerRef.current = document.activeElement as HTMLElement | null;
        dialog.showModal();
      }
      if (!open && dialog.open) {
        dialog.close();
      }
    },
    [open],
  );

  function closeOnBackdropClick(event: React.MouseEvent<HTMLDialogElement>) {
    // A click on the backdrop is reported with the dialog itself as the target.
    if (event.target === event.currentTarget) onClose();
  }

  function handleClose() {
    openerRef.current?.focus();
    onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      aria-label={title}
      onClose={handleClose}
      onClick={closeOnBackdropClick}
      className={`${SURFACE} m-auto w-[min(24rem,calc(100vw-2rem))] p-0 backdrop:bg-black/50`}
    >
      <div className="flex flex-col gap-3 p-4">
        <h2 className="font-medium">{title}</h2>
        {children}
      </div>
    </dialog>
  );
}
