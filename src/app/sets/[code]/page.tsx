import { notFound } from "next/navigation";
import { FINISHES, findSet, setPrintings, type Finish } from "@/modules/catalog";
import { getContainer } from "@/server/container";
import { requireActor } from "@/server/session";
import { Cents } from "@/shared/kernel";
import { KeyruneStylesheet, SetSymbol } from "@/ui/set-symbol";

const FINISH_LABELS: Record<Finish, string> = {
  nonfoil: "Nonfoil",
  foil: "Foil",
  etched: "Etched",
};

const RARITY_COLORS: Record<string, string> = {
  common: "text-zinc-500",
  uncommon: "text-slate-500",
  rare: "text-amber-600",
  mythic: "text-orange-600",
};

export default async function SetPage(props: PageProps<"/sets/[code]">) {
  await requireActor();
  const { code } = await props.params;
  const { db } = getContainer();
  const set = await findSet(db, code);
  if (set === null) notFound();
  const printings = await setPrintings(db, set.code);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-12">
      <KeyruneStylesheet />
      <header className="flex items-center gap-3">
        <SetSymbol keyruneCode={set.keyruneCode} className="text-4xl" />
        <div>
          <h1 className="text-2xl font-semibold">{set.name}</h1>
          <p className="text-sm text-zinc-500">
            {set.code} · released {set.releaseDate} · {printings.length} printings
          </p>
        </div>
      </header>

      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {printings.map((printing) => (
          <li key={printing.id} className="flex flex-col gap-1 text-sm">
            {printing.hasImage ? (
              // A plain <img>: images come pre-sized from our cache, and lazy loading keeps a
              // 400-card page from fetching everything at once.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/images/${printing.id}/small/front`}
                alt={printing.name}
                loading="lazy"
                width={146}
                height={204}
                className="aspect-[146/204] w-full rounded-[4.5%] bg-zinc-100 dark:bg-zinc-800"
              />
            ) : (
              <div className="flex aspect-[146/204] w-full items-center justify-center rounded-md bg-zinc-100 p-2 text-center text-xs text-zinc-500 dark:bg-zinc-800">
                {printing.name}
              </div>
            )}
            <span className="leading-tight font-medium">{printing.name}</span>
            <span className={`text-xs ${RARITY_COLORS[printing.rarity] ?? "text-zinc-500"}`}>
              #{printing.collectorNumber} · {printing.rarity}
              {printing.variantLabel && ` · ${printing.variantLabel}`}
            </span>
            <span className="text-xs text-zinc-600 tabular-nums dark:text-zinc-400">
              {FINISHES.filter((finish) => printing.finishes.includes(finish))
                .map((finish) => {
                  const price = printing.prices[finish];
                  return `${FINISH_LABELS[finish]} ${price === undefined ? "—" : Cents.format(price)}`;
                })
                .join(" · ")}
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}
