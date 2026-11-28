import Link from "next/link";
import { readPage } from "@/server/page-instance";
import { KeyruneStylesheet } from "@/ui/mtg/set-symbol";
import { Page } from "@/ui/page";
import { resolveActiveTheme } from "../../_components/resolve-theme";
import { AppearanceForm } from "./appearance-form";

/** Choose a curated palette or MTG plane theme for your account. */
export default async function AppearancePage() {
  const { actor, reads } = await readPage();
  const [savedPreference, active] = await Promise.all([
    reads.social.themePreference(actor),
    resolveActiveTheme(),
  ]);

  return (
    <Page width="3xl">
      <KeyruneStylesheet />
      <div className="flex flex-col gap-1">
        <Link href="/account" className="text-muted w-fit text-sm underline">
          ← Account
        </Link>
        <h1 className="text-2xl font-semibold">Appearance</h1>
        <p className="text-muted text-sm">
          Pick a color palette or Magic plane theme. Your choice saves to your account and applies
          across every page.
        </p>
      </div>

      <AppearanceForm
        initialPreference={savedPreference}
        activeCredit={active.backdrop?.credit ?? null}
      />
    </Page>
  );
}
