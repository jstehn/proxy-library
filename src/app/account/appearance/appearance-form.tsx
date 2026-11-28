"use client";

import { useActionState, useState } from "react";
import type { ThemeId, ThemePreference } from "@/shared/kernel";
import { Alert, SubmitButton } from "@/ui/form";
import { SetSymbol } from "@/ui/mtg/set-symbol";
import { themesByCategory, type ThemeCategory, type ThemeDefinition } from "@/ui/themes";
import { saveAppearanceAction, type AppearanceFormState } from "./actions";

type AppearanceFormProps = Readonly<{
  initialPreference: ThemePreference;
  activeCredit: string | null;
}>;

const CATEGORY_SECTIONS: ReadonlyArray<
  Readonly<{ category: ThemeCategory; heading: string; subtitle: string }>
> = [
  {
    category: "default",
    heading: "Default",
    subtitle: "The neutral Proxy Library look, following your device or pinned to light or dark.",
  },
  {
    category: "palette",
    heading: "Color palettes",
    subtitle: "Clean color themes with no background artwork.",
  },
  {
    category: "plane",
    heading: "MTG planes",
    subtitle:
      "Curated palettes, official artwork backdrops, display typography, and corner shapes.",
  },
];

const INITIAL_STATE: AppearanceFormState = { error: null, saved: false };

const CARD_BASE = "flex cursor-pointer flex-col gap-2 rounded-card border p-3 text-left";
const CARD_SELECTED = "border-accent bg-surface ring-2 ring-accent/30";
const CARD_IDLE = "border-border-subtle bg-card hover:border-line";

function ThemeOptionCard({
  theme,
  selected,
  onSelect,
}: Readonly<{
  theme: ThemeDefinition;
  selected: boolean;
  onSelect: (id: ThemeId) => void;
}>) {
  const previewRadius = theme.shape?.cardRadius ?? "0.5rem";
  const previewFont = theme.typography?.displayFont;

  return (
    <label className={`${CARD_BASE} ${selected ? CARD_SELECTED : CARD_IDLE}`}>
      <input
        type="radio"
        name="themeId"
        value={theme.id}
        checked={selected}
        onChange={() => onSelect(theme.id)}
        className="sr-only"
      />
      <div className="flex items-center justify-between gap-2">
        <span
          className="flex items-center gap-1.5 text-sm font-semibold"
          style={previewFont ? { fontFamily: previewFont } : undefined}
        >
          {theme.setCode && <SetSymbol keyruneCode={theme.setCode} className="text-base" />}
          {theme.name}
        </span>
        <span className="flex items-center gap-1" aria-hidden="true">
          {theme.swatches.map((color, index) => (
            <span
              key={`${theme.id}-swatch-${index}`}
              className="border-line inline-block h-4 w-4 border"
              style={{ backgroundColor: color, borderRadius: previewRadius }}
            />
          ))}
        </span>
      </div>
      <p className="text-muted text-xs">{theme.description}</p>
    </label>
  );
}

export function AppearanceForm({ initialPreference, activeCredit }: AppearanceFormProps) {
  const [selectedThemeId, setSelectedThemeId] = useState<ThemeId>(initialPreference.themeId);
  const [showBackdrop, setShowBackdrop] = useState<boolean>(initialPreference.showBackdrop);
  const [state, formAction] = useActionState(saveAppearanceAction, INITIAL_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-8">
      {state.error !== null && <Alert tone="error">{state.error}</Alert>}
      {state.saved && <Alert tone="success">Theme updated across your account.</Alert>}

      {CATEGORY_SECTIONS.map((section) => {
        const themes = themesByCategory(section.category);
        return (
          <fieldset key={section.category} className="flex flex-col gap-3">
            <div className="flex flex-col gap-0.5">
              <legend className="text-base font-semibold">{section.heading}</legend>
              <p className="text-muted text-sm">{section.subtitle}</p>
            </div>
            <div
              className={
                section.category === "default"
                  ? "grid grid-cols-1 gap-3 sm:grid-cols-3"
                  : "grid grid-cols-1 gap-3 sm:grid-cols-2"
              }
            >
              {themes.map((theme) => (
                <ThemeOptionCard
                  key={theme.id}
                  theme={theme}
                  selected={selectedThemeId === theme.id}
                  onSelect={setSelectedThemeId}
                />
              ))}
            </div>
          </fieldset>
        );
      })}

      <div className="border-border-subtle bg-card rounded-card flex flex-col gap-2 border p-4">
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            name="showBackdrop"
            checked={showBackdrop}
            onChange={(event) => setShowBackdrop(event.target.checked)}
            className="mt-1 h-4 w-4 shrink-0"
          />
          <span className="flex flex-col gap-0.5">
            <span className="font-medium">Show background artwork on plane themes</span>
            <span className="text-muted text-xs">
              Turn off for palette-only mode: keeps each plane&apos;s colors, headings, and corner
              shapes without the background image.
            </span>
          </span>
        </label>
        {activeCredit !== null && <p className="text-muted pl-7 text-xs">{activeCredit}</p>}
      </div>

      <div className="flex items-center gap-3">
        <SubmitButton pendingText="Applying…">Apply theme</SubmitButton>
      </div>
    </form>
  );
}
