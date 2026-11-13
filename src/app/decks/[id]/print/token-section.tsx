"use client";
import { useState, useTransition } from "react";
import { tokenDescription, type TokenArt, type TokenLine } from "@/modules/decks/client";
import { chooseTokenAction, tokenArtsAction } from "./actions";

// The print page's tokens (design doc 25): each token the deck's cards make, whether it prints,
// and its art. Every change is saved for the deck at once.

/** Above this many arts, a filter box helps find one (Treasure has nearly a hundred). */
const FILTER_FROM = 20;

/** The radio value for "the default art". */
const DEFAULT_ART = "default";

type Props = Readonly<{
  deckId: number;
  tokens: readonly TokenLine[];
  onTokensChange: (tokens: TokenLine[]) => void;
}>;

export function TokenList({ deckId, tokens, onTokensChange }: Props) {
  const [message, setMessage] = useState<string | null>(null);

  if (tokens.length === 0) {
    return <p className="text-muted text-sm">None of this deck&apos;s cards make tokens.</p>;
  }

  async function save(token: TokenLine, change: TokenChange) {
    const result = await chooseTokenAction({ deckId, tokenOracleId: token.oracleId, ...change });
    if (!result.ok) {
      setMessage(result.message);
      return false;
    }
    setMessage(null);
    onTokensChange(result.tokens);
    return true;
  }

  return (
    <div className="flex flex-col gap-2">
      {message !== null && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {message}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {tokens.map((token) => (
          <TokenRow key={token.oracleId} token={token} save={save} />
        ))}
      </ul>
    </div>
  );
}

/** What a row changes: the art (null for the default) and whether the token prints. */
type TokenChange = Readonly<{ tokenId: string | null; included: boolean }>;

type Save = (token: TokenLine, change: TokenChange) => Promise<boolean>;

type TokenRowProps = Readonly<{ token: TokenLine; save: Save }>;

function TokenRow({ token, save }: TokenRowProps) {
  const [isSaving, startSaving] = useTransition();
  const [isPicking, setIsPicking] = useState(false);
  // Every art of the token, fetched the first time the picker opens.
  const [arts, setArts] = useState<TokenArt[] | "loading" | null>(null);
  const chosenId = token.artChosen ? token.art.id : null;

  function togglePicker() {
    setIsPicking((open) => !open);
    if (arts !== null) return;
    setArts("loading");
    void tokenArtsAction({ tokenOracleId: token.oracleId }).then((found) => setArts(found ?? []));
  }

  // The tick being saved, so the box changes the moment it's clicked.
  const [savingIncluded, setSavingIncluded] = useState<boolean | null>(null);
  const included = savingIncluded ?? token.included;

  function setIncluded(value: boolean) {
    setSavingIncluded(value);
    startSaving(async () => {
      await save(token, { tokenId: chosenId, included: value });
      setSavingIncluded(null);
    });
  }

  return (
    <li
      className={`flex flex-col gap-2 rounded-md border border-zinc-200 p-2 dark:border-zinc-800 ${included ? "" : "opacity-60"}`}
      aria-busy={isSaving}
    >
      <div className="flex items-start gap-3">
        {/* A finger-sized tap area round a small checkbox. */}
        <label className="-m-2 flex size-10 shrink-0 cursor-pointer items-center justify-center">
          <input
            type="checkbox"
            checked={included}
            disabled={isSaving}
            onChange={(event) => setIncluded(event.target.checked)}
            aria-label={`Print ${token.name}`}
            className="size-4"
          />
        </label>
        <TokenImage art={token.art} className="w-14" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
          <p>
            <span className="font-medium">{token.name}</span>{" "}
            <span className="text-muted">{tokenDescription(token.art)}</span>
          </p>
          <p className="text-muted text-xs">Made by {token.madeBy.join(", ")}</p>
          <p className="text-muted text-xs">
            Art: {artLabel(token.art)}
            {token.artChosen ? " (chosen)" : " (default)"}
          </p>
        </div>
        <button
          type="button"
          onClick={togglePicker}
          aria-expanded={isPicking}
          className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700"
        >
          {isPicking ? "Done" : "Change art"}
        </button>
      </div>
      {isPicking && arts !== null && <ArtPicker token={token} arts={arts} save={save} />}
    </li>
  );
}

type ArtPickerProps = Readonly<{ token: TokenLine; arts: TokenArt[] | "loading"; save: Save }>;

function ArtPicker({ token, arts, save }: ArtPickerProps) {
  const [filter, setFilter] = useState("");
  const [isSaving, startSaving] = useTransition();
  // The choice being saved, so the radio moves the moment it's clicked.
  const [saving, setSaving] = useState<string | null>(null);

  const current = token.artChosen ? token.art.id : DEFAULT_ART;
  const checked = saving ?? current;
  const groupName = `token-art-${token.oracleId}`;

  function choose(value: string) {
    setSaving(value);
    startSaving(async () => {
      await save(token, {
        tokenId: value === DEFAULT_ART ? null : value,
        included: token.included,
      });
      setSaving(null);
    });
  }

  const words = filter.trim().toLowerCase();
  const shown =
    arts === "loading"
      ? []
      : arts.filter(
          (art) =>
            words === "" ||
            `${art.setCode} ${art.setName} ${art.collectorNumber} ${art.artist ?? ""}`
              .toLowerCase()
              .includes(words),
        );
  const defaultArt =
    arts === "loading" ? undefined : arts.find((art) => art.id === token.defaultArtId);

  return (
    <fieldset
      className="flex flex-col gap-2 rounded-md border border-zinc-200 p-2 text-xs dark:border-zinc-800"
      aria-busy={isSaving}
    >
      <legend className="px-1 text-sm font-medium">Choose {token.name} art</legend>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-h-9 items-center gap-2">
          <input
            type="radio"
            name={groupName}
            checked={checked === DEFAULT_ART}
            disabled={isSaving}
            onChange={() => choose(DEFAULT_ART)}
          />
          <span>
            Default
            {defaultArt !== undefined && (
              <span className="text-muted"> ({artLabel(defaultArt)})</span>
            )}
          </span>
        </label>
        {arts !== "loading" && arts.length > FILTER_FROM && (
          <input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter by set, number or artist"
            aria-label={`Filter ${token.name} art`}
            className="min-w-0 flex-1 rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
          />
        )}
        {isSaving && <span className="text-muted">Saving…</span>}
      </div>
      {arts === "loading" && <p className="text-muted">Loading the art…</p>}
      {arts !== "loading" && shown.length === 0 && <p className="text-muted">No art matches.</p>}
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {shown.map((art) => {
          const isChecked = checked === art.id;
          return (
            <li key={art.id}>
              <label
                className={`flex cursor-pointer flex-col gap-1 rounded-md border p-1 ${isChecked ? "border-sky-600 bg-sky-50 dark:border-sky-500 dark:bg-sky-950" : "border-zinc-200 dark:border-zinc-800"}`}
              >
                <input
                  type="radio"
                  name={groupName}
                  className="sr-only"
                  checked={isChecked}
                  disabled={isSaving}
                  onChange={() => choose(art.id)}
                  aria-label={artLabel(art)}
                />
                <TokenImage art={art} className="w-full" />
                <span className="truncate">
                  {art.setCode.toUpperCase()} #{art.collectorNumber}
                </span>
                <span className="text-muted truncate">{art.releasedAt.slice(0, 4)}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

type TokenImageProps = Readonly<{ art: TokenArt; className: string }>;

function TokenImage({ art, className }: TokenImageProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- served by our image cache
    <img
      src={`/api/images/${art.id}/small/front`}
      alt=""
      loading="lazy"
      width={146}
      height={204}
      className={`aspect-[146/204] shrink-0 rounded-[4.5%] bg-zinc-100 dark:bg-zinc-800 ${className}`}
    />
  );
}

/** "Bloomburrow Tokens #12", or the set code when the set isn't listed. */
function artLabel(art: TokenArt): string {
  return `${art.setName} #${art.collectorNumber}`;
}
