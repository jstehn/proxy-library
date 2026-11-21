import Link from "next/link";
import { requireActor } from "@/server/session";
import { RealImporter } from "./importer";
import { Page } from "@/ui/page";

// Import real cards (design doc 16, section 7): a pasted list, or a Moxfield or ManaBox file.

export default async function RealImportPage() {
  await requireActor();
  return (
    <Page width="5xl">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Import real cards</h1>
        <p className="text-muted text-sm">
          Paste a list as deck sites write it (<code>4 Lightning Bolt</code>,{" "}
          <code>1 Sol Ring (C21) 263 *F*</code>), or choose a collection file from Moxfield or
          ManaBox, or one exported from here. A card named without a set becomes its newest regular
          printing; change any line before importing. Condition and language are ignored.{" "}
          <Link href="/collection/real" className="underline">
            Back to your real collection
          </Link>
        </p>
      </header>
      <RealImporter />
    </Page>
  );
}
