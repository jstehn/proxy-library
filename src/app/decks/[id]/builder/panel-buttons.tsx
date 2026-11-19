"use client";
import type { Dispatch } from "react";
import type { Format } from "@/modules/decks";
import { formatRules } from "@/modules/decks/client";
import type { BuilderAction, PanelName } from "./builder-state";

// The row of buttons that open and close the builder's panels (design doc 14, section 2.4).

type PanelButton = Readonly<{
  panel: PanelName;
  /** The label when closed; the open label is "Hide" and this, lower-cased where it's a plain word. */
  label: string;
  hideLabel: string;
}>;

const BUTTONS_BEFORE_DRAFT: readonly PanelButton[] = [
  { panel: "suggestions", label: "Suggestions", hideLabel: "Hide suggestions" },
  { panel: "cuts", label: "Possible cuts", hideLabel: "Hide possible cuts" },
  { panel: "manaBase", label: "Mana base", hideLabel: "Hide mana base" },
];

const BUTTONS_AFTER_DRAFT: readonly PanelButton[] = [
  { panel: "testHand", label: "Test hand", hideLabel: "Hide test hand" },
  { panel: "snapshots", label: "Snapshots", hideLabel: "Hide snapshots" },
  { panel: "tokens", label: "Tokens", hideLabel: "Hide tokens" },
  { panel: "primer", label: "Plan & primer", hideLabel: "Hide plan & primer" },
];

export function PanelButtons(props: {
  format: Format;
  openPanels: Readonly<Record<PanelName, boolean>>;
  /** Cards counted in the deck, and how many a full deck has, for the draft button's label. */
  cardTotal: number;
  draftTarget: number;
  dispatch: Dispatch<BuilderAction>;
}) {
  const { openPanels, dispatch } = props;
  const draftLabel =
    props.cardTotal > 0 && props.cardTotal < props.draftTarget
      ? `Draft deck (fill ${props.draftTarget - props.cardTotal})`
      : "Draft deck";
  const draftButton: PanelButton = { panel: "draft", label: draftLabel, hideLabel: "Hide draft" };
  const buttons = [
    ...BUTTONS_BEFORE_DRAFT,
    ...(formatRules(props.format).canDraftDeck ? [draftButton] : []),
    ...BUTTONS_AFTER_DRAFT,
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {buttons.map((button) => (
        <button
          key={button.panel}
          type="button"
          aria-expanded={openPanels[button.panel]}
          onClick={() => dispatch({ type: "panelToggled", panel: button.panel })}
          className="rounded-md border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700"
        >
          {openPanels[button.panel] ? button.hideLabel : button.label}
        </button>
      ))}
    </div>
  );
}
