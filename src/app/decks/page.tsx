import Link from "next/link";
import { FORMATS } from "@/modules/decks";
import { readPage } from "@/server/page-instance";
import { Alert } from "@/ui/form";
import { LocalTime } from "@/ui/local-time";
import { createDeckAction } from "./actions";
import { FORMAT_LABELS } from "./labels";
import { Button } from "@/ui/button";
import { Input, Select } from "@/ui/field";
import { Page } from "@/ui/page";
import { EmptyState } from "@/ui/empty-state";
import { Badge } from "@/ui/badge";

const SHARED_BADGE =
  "rounded bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-800 dark:bg-violet-950 dark:text-violet-200";

export default async function DecksPage(props: PageProps<"/decks">) {
  const { actor, reads } = await readPage();
  const searchParams = await props.searchParams;
  const allDecks = await reads.decks.decksFor(actor);
  // ?show=drafts lists only the decks finished drafts made (design doc 17).
  const onlyDrafts = searchParams.show === "drafts";
  const decks = onlyDrafts ? allDecks.filter((deck) => deck.origin !== null) : allDecks;
  const draftCount = allDecks.filter((deck) => deck.origin !== null).length;
  const error = searchParams.error;

  return (
    <Page spacing="roomy">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Decks</h1>
        <p className="text-muted text-sm">
          Build from the cards you own, then print proxies to play with. A deck can use every copy
          you own, even if another deck uses them too.
        </p>
        <p className="flex flex-wrap gap-3 text-sm">
          <Link href="/decks/shared" className="underline">
            Decks shared by the playgroup
          </Link>
          <Link href="/decks/to-get" className="underline">
            Cards to get for all your decks
          </Link>
          <Link href="/decks/commanders" className="underline">
            Find a commander
          </Link>
        </p>
      </header>
      {typeof error === "string" && <Alert tone="error">{error}</Alert>}

      <form action={createDeckAction} className="flex flex-wrap items-center gap-2">
        <Input
          name="name"
          placeholder="New deck name"
          aria-label="Deck name"
          required
          maxLength={60}
          className="w-64"
        />
        <Select name="format" aria-label="Format" defaultValue="commander">
          {FORMATS.map((format) => (
            <option key={format} value={format}>
              {FORMAT_LABELS[format]}
            </option>
          ))}
        </Select>
        <Button type="submit">Create deck</Button>
      </form>

      {draftCount > 0 && (
        <nav className="flex gap-3 text-sm" aria-label="Which decks">
          <Link
            href="/decks"
            aria-current={onlyDrafts ? undefined : "page"}
            className={onlyDrafts ? "underline" : "font-semibold"}
          >
            All decks ({allDecks.length})
          </Link>
          <Link
            href="/decks?show=drafts"
            aria-current={onlyDrafts ? "page" : undefined}
            className={onlyDrafts ? "font-semibold" : "underline"}
          >
            Draft decks ({draftCount})
          </Link>
        </nav>
      )}

      {decks.length === 0 ? (
        <EmptyState>No decks yet.</EmptyState>
      ) : (
        <ul className="divide-border-subtle flex flex-col divide-y">
          {decks.map((deck) => (
            <li key={deck.id} className="flex flex-wrap items-center gap-3 py-3">
              <Link href={`/decks/${deck.id}`} className="font-medium underline">
                {deck.name}
              </Link>
              {deck.origin?.kind === "draft" && (
                <Link
                  href={`/drafts/${deck.origin.draftId}`}
                  className={SHARED_BADGE}
                  title="Made by a draft: open the draft"
                >
                  Draft
                </Link>
              )}
              {deck.visibility === "shared" && (
                <Badge title="Every player can see this deck" tone="sky">
                  Shared
                </Badge>
              )}
              <span className="text-muted text-sm">
                {FORMAT_LABELS[deck.format]} · {deck.cards} cards
              </span>
              {deck.usesRealCards && (
                <Badge title="Cards you own for real count as owned in this deck" tone="amber">
                  real cards
                </Badge>
              )}
              {deck.short > 0 ? (
                <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-950 dark:text-red-200">
                  short {deck.short}
                </span>
              ) : (
                <Badge tone="green">all owned</Badge>
              )}
              <span className="flex-1" />
              <span className="text-muted text-xs">
                changed <LocalTime iso={deck.updatedAt} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
