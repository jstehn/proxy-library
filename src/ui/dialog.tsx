"use client";
// The one modal dialog, built on the native <dialog> element. `showModal()` makes the browser
// trap focus inside it, close it on Escape, make the page behind it inert, and return focus to
// the invoker on close. Light-dismiss uses `closedby="any"` with a bounding-box pointer fallback
// for browsers that lack `closedBy` (e.g. Safari).
import { useEffect, useId, useRef } from "react";

type DialogSize = "sm" | "lg" | "xl";

type DialogProps = {
  open: boolean;
  /** Called when the dialog closes itself (Escape, backdrop click, or close button). */
  onClose: () => void;
  title: string;
  size?: DialogSize;
  /** Show a top-right Close button next to the title (recommended for content modals). */
  showCloseButton?: boolean;
  children: React.ReactNode;
};

const SURFACE = "bg-background text-foreground border-line rounded-lg border shadow-xl";

const SIZE_CLASSES: Record<DialogSize, string> = {
  sm: "w-[min(24rem,calc(100vw-2rem))]",
  lg: "w-[min(42rem,calc(100vw-2rem))] max-h-[min(85dvh,48rem)]",
  xl: "w-[min(56rem,calc(100vw-2rem))] max-h-[min(88dvh,54rem)]",
};

function isOutsideDialog(event: PointerEvent, dialog: HTMLDialogElement): boolean {
  const rect = dialog.getBoundingClientRect();
  return (
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom
  );
}

export function Dialog(props: DialogProps) {
  const { open, onClose, title, size = "sm", showCloseButton = false, children } = props;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(
    function syncWithNativeDialog() {
      const dialog = dialogRef.current;
      if (!dialog) return;
      if (open && !dialog.open) {
        dialog.showModal();
      }
      if (!open && dialog.open) {
        dialog.close();
      }
    },
    [open],
  );

  // Fallback for browsers without native `closedby="any"` support: require both pointerdown and
  // pointerup outside the dialog's box so text-selection drags onto the backdrop do not dismiss.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || "closedBy" in HTMLDialogElement.prototype) return;
    let pressedOutside = false;
    function onPointerDown(event: PointerEvent) {
      if (dialog) pressedOutside = isOutsideDialog(event, dialog);
    }
    function onPointerUp(event: PointerEvent) {
      if (dialog && pressedOutside && isOutsideDialog(event, dialog)) {
        dialog.close();
      }
      pressedOutside = false;
    }
    dialog.addEventListener("pointerdown", onPointerDown);
    dialog.addEventListener("pointerup", onPointerUp);
    return () => {
      dialog.removeEventListener("pointerdown", onPointerDown);
      dialog.removeEventListener("pointerup", onPointerUp);
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      {...({ closedby: "any" } as Record<string, string>)}
      className={`${SURFACE} ${SIZE_CLASSES[size]} m-auto p-0 backdrop:bg-black/50`}
    >
      <div className="flex max-h-[inherit] flex-col">
        <div className="border-border-subtle flex items-center justify-between gap-3 border-b px-4 py-3">
          <h1 id={titleId} className="text-base font-semibold">
            {title}
          </h1>
          {showCloseButton && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="border-line text-muted hover:text-foreground rounded-md border px-2 py-1 text-xs font-medium"
            >
              Close
            </button>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">{children}</div>
      </div>
    </dialog>
  );
}
