"use client";
// A button for something that can't be undone. It opens a small dialog with a short question;
// only the danger "Confirm" button inside it goes on. Two ways to use it:
//   - Inside a <form>: put it where the submit button was. Confirming submits that form.
//   - With `onConfirm`: confirming calls it (for actions that aren't a form).
// Use it for destructive actions only, never for reversible ones (renaming, adding to a wishlist).
import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button, type ButtonSize, type ButtonVariant } from "./button";
import { Dialog } from "./dialog";

type ConfirmButtonProps = {
  /** The trigger button's text. */
  children: React.ReactNode;
  /** The short question the dialog asks, e.g. "Delete this deck? This can't be undone." */
  question: string;
  /** The danger button's text. Defaults to "Confirm". */
  confirmLabel?: string;
  /** Without it, confirming submits the surrounding form. */
  onConfirm?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
};

/**
 * The danger button that submits the surrounding form. It says "Working…" and is disabled while
 * the form submits, and closes the dialog when the submit has finished (an action that redirects
 * leaves the page first, so this only matters when the page stays).
 */
function ConfirmSubmitButton(props: { label: string; onFinished: () => void }) {
  const { label, onFinished } = props;
  const { pending } = useFormStatus();
  const wasPending = useRef(false);

  useEffect(
    function closeWhenSubmitFinishes() {
      if (wasPending.current && !pending) onFinished();
      wasPending.current = pending;
    },
    [pending, onFinished],
  );

  return (
    <Button type="submit" variant="danger" disabled={pending}>
      {pending ? "Working…" : label}
    </Button>
  );
}

export function ConfirmButton(props: ConfirmButtonProps) {
  const { children, question, confirmLabel = "Confirm", onConfirm, ...look } = props;
  const [open, setOpen] = useState(false);

  function confirm() {
    setOpen(false);
    onConfirm?.();
  }

  function close() {
    setOpen(false);
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)} {...look}>
        {children}
      </Button>
      <Dialog open={open} onClose={close} title={question}>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={close}>
            Cancel
          </Button>
          {onConfirm ? (
            <Button type="button" variant="danger" onClick={confirm}>
              {confirmLabel}
            </Button>
          ) : (
            <ConfirmSubmitButton label={confirmLabel} onFinished={close} />
          )}
        </div>
      </Dialog>
    </>
  );
}
