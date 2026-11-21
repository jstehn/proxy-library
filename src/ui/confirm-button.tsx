"use client";
// A button for something that can't be undone. It opens a small dialog with a short question;
// only the danger "Confirm" button inside it goes on. Two ways to use it:
//   - Inside a <form>: put it where the submit button was. Confirming submits that form.
//   - With `onConfirm`: confirming calls it (for actions that aren't a form).
// Use it for destructive actions only, never for reversible ones (renaming, adding to a wishlist).
import { useState } from "react";
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

export function ConfirmButton(props: ConfirmButtonProps) {
  const { children, question, confirmLabel = "Confirm", onConfirm, ...look } = props;
  const [open, setOpen] = useState(false);

  function confirm() {
    setOpen(false);
    onConfirm?.();
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)} {...look}>
        {children}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={question}>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type={onConfirm ? "button" : "submit"} variant="danger" onClick={confirm}>
            {confirmLabel}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
