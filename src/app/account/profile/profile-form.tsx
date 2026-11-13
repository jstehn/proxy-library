"use client";

import { useActionState } from "react";
import { formatLabel } from "@/app/decks/labels";
import {
  MANA_COLORS,
  MAX_BIO_LENGTH,
  VISIBILITIES,
  type SectionVisibility,
} from "@/modules/social/client";
import { Alert } from "@/ui/form";
import { saveProfileAction, type ProfileFormState } from "./actions";

const COLOR_NAMES: Record<string, string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
};

const VISIBILITY_LABELS: Record<SectionVisibility, string> = {
  everyone: "Everyone in the playgroup",
  friends: "Friends only",
  only_me: "Only me",
};

export function ProfileForm(props: {
  formats: readonly string[];
  initial: {
    bio: string;
    favoriteColors: readonly string[];
    favoriteFormats: readonly string[];
    showcaseDeckId: number | null;
    showcaseCards: readonly { printingId: string; name: string }[];
    statsVisibility: SectionVisibility;
    wishlistVisibility: SectionVisibility;
    sharedDecks: readonly { id: number; name: string; format: string }[];
  };
}) {
  const [state, action, pending] = useActionState<ProfileFormState, FormData>(saveProfileAction, {
    error: null,
  });

  return (
    <form action={action} className="flex flex-col gap-6">
      {state.error && <Alert tone="error">{state.error}</Alert>}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="bio" className="text-sm font-medium">
          Bio
        </label>
        <textarea
          id="bio"
          name="bio"
          rows={4}
          maxLength={MAX_BIO_LENGTH}
          defaultValue={props.initial.bio}
          placeholder="Tell the playgroup about your playstyle, favorite commanders, or what you're looking to trade for."
          className="rounded-md border border-zinc-300 bg-transparent p-2.5 text-sm dark:border-zinc-700"
        />
        <span className="text-muted text-xs">Up to {MAX_BIO_LENGTH} characters.</span>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Favorite colors</legend>
        <div className="flex flex-wrap gap-3">
          {MANA_COLORS.map((color) => (
            <label key={color} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                name="favoriteColors"
                value={color}
                defaultChecked={props.initial.favoriteColors.includes(color)}
              />
              <span>{COLOR_NAMES[color] ?? color}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Favorite formats</legend>
        <div className="flex flex-wrap gap-3">
          {props.formats.map((format) => (
            <label key={format} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                name="favoriteFormats"
                value={format}
                defaultChecked={props.initial.favoriteFormats.includes(format)}
              />
              <span>{formatLabel(format)}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="showcaseDeckId" className="text-sm font-medium">
          Showcase deck
        </label>
        <select
          id="showcaseDeckId"
          name="showcaseDeckId"
          defaultValue={props.initial.showcaseDeckId ?? ""}
          className="rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
        >
          <option value="">None</option>
          {props.initial.sharedDecks.map((deck) => (
            <option key={deck.id} value={deck.id}>
              {deck.name} ({formatLabel(deck.format)})
            </option>
          ))}
        </select>
        <span className="text-muted text-xs">
          Only your shared decks can be showcased on your profile.
        </span>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Showcase cards (up to 3)</legend>
        <p className="text-muted text-xs">
          Paste a card&apos;s printing ID (the ID at the end of a <code>/cards/&lt;id&gt;</code>{" "}
          URL).
        </p>
        {[0, 1, 2].map((index) => {
          const existing = props.initial.showcaseCards[index];
          return (
            <div key={index} className="flex flex-col gap-1">
              <input
                type="text"
                name={`showcaseCard${index + 1}`}
                defaultValue={existing?.printingId ?? ""}
                placeholder={`Showcase card ${index + 1} printing ID`}
                className="rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm dark:border-zinc-700"
              />
              {existing && <span className="text-muted text-xs">Currently: {existing.name}</span>}
            </div>
          );
        })}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="statsVisibility" className="text-sm font-medium">
            Who can see your stats
          </label>
          <select
            id="statsVisibility"
            name="statsVisibility"
            defaultValue={props.initial.statsVisibility}
            className="rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
          >
            {VISIBILITIES.map((vis) => (
              <option key={vis} value={vis}>
                {VISIBILITY_LABELS[vis]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="wishlistVisibility" className="text-sm font-medium">
            Who can see your wishlist
          </label>
          <select
            id="wishlistVisibility"
            name="wishlistVisibility"
            defaultValue={props.initial.wishlistVisibility}
            className="rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
          >
            {VISIBILITIES.map((vis) => (
              <option key={vis} value={vis}>
                {VISIBILITY_LABELS[vis]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {pending ? "Saving…" : "Save profile"}
        </button>
      </div>
    </form>
  );
}
