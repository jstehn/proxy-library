import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { publicDeckScorecard } from "@/modules/decks";
import { getContainer } from "@/server/container";
import { FORMAT_LABELS } from "../../../decks/labels";

export async function generateMetadata(
  props: PageProps<"/d/[token]/scorecard">,
): Promise<Metadata> {
  const { token } = await props.params;
  const found = await publicDeckScorecard(getContainer().db, token);
  if (found === null) return { title: "Scorecard not found — Proxy Library" };
  return {
    title: `${found.report.deck.name} Scorecard — Proxy Library`,
    description: `${FORMAT_LABELS[found.report.deck.format]} deck scorecard shared by ${found.ownerName}.`,
  };
}

export default async function PublicDeckScorecardPage(props: PageProps<"/d/[token]/scorecard">) {
  const { token } = await props.params;
  const found = await publicDeckScorecard(getContainer().db, token);
  if (found === null) notFound();

  const { ownerName, report } = found;
  const { deck, score, bracket, roles, mana, goldfish, legality } = report;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">{deck.name} — Scorecard</h1>
          <p className="text-muted text-sm">
            {FORMAT_LABELS[deck.format]} · shared by {ownerName} · {deck.cardCount} cards
          </p>
        </div>
        <Link
          href={`/d/${token}`}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium dark:border-zinc-700"
        >
          View full list
        </Link>
      </header>

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <p className="text-muted text-xs uppercase">Deck Score</p>
          <p className="mt-1 text-2xl font-semibold">{score.total.toFixed(1)}</p>
        </div>
        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <p className="text-muted text-xs uppercase">Bracket</p>
          <p className="mt-1 text-2xl font-semibold">
            {bracket ? `B${bracket.floor}${bracket.target ? ` / T${bracket.target}` : ""}` : "—"}
          </p>
        </div>
        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <p className="text-muted text-xs uppercase">Cast on Curve</p>
          <p className="mt-1 text-2xl font-semibold">{mana.averageCastOnCurvePct}%</p>
        </div>
        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <p className="text-muted text-xs uppercase">Keepable Hands</p>
          <p className="mt-1 text-2xl font-semibold">{goldfish.keepableRatePct}%</p>
        </div>
      </section>

      {bracket && bracket.reasons.length > 0 && (
        <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="text-base font-semibold">Bracket Reasons</h2>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {bracket.reasons.map((reason, index) => (
              <li key={`${reason.rule}-${index}`}>
                <span className="font-medium">Bracket {reason.bracketFloor}:</span> {reason.summary}
              </li>
            ))}
          </ul>
        </section>
      )}

      {roles.length > 0 && (
        <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="text-base font-semibold">Role Coverage</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {roles.map((role) => (
              <div
                key={role.tag}
                className="rounded border border-zinc-100 px-3 py-2 text-sm dark:border-zinc-800"
              >
                <div className="font-medium capitalize">{role.tag}</div>
                <div className="text-muted">
                  {role.count} / {role.target}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-base font-semibold">Mana &amp; Legality</h2>
        <p className="mt-1 text-sm">
          {mana.lands} lands (suggested {mana.suggestedLands}) · avg MV{" "}
          {mana.averageManaValue.toFixed(2)}
          {mana.underservedColors.length > 0
            ? ` · underserved colors: ${mana.underservedColors.join(", ")}`
            : " · colors balanced"}
        </p>
        <p className="mt-1 text-sm">
          {legality.problemCount === 0
            ? "No legality issues."
            : `${legality.problemCount} legality issue(s): ${legality.problems.join("; ")}`}
        </p>
      </section>
    </main>
  );
}
