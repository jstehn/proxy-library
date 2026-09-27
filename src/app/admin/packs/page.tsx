import { CardTile } from "@/app/_components/card-tile";
import { printingCards, SetCode, type PrintingCard } from "@/modules/catalog";
import {
  availableBoosters,
  COUNT_KEYS,
  SIMULATION_LIMIT,
  type BoosterChoice,
  type CountKey,
  type Pack,
  type PackCard,
  type SimulateOpeningsError,
  type SimulationReport,
} from "@/modules/packs";
import { packMsrp } from "@/modules/store";
import { getContainer } from "@/server/container";
import { requireAdminActor } from "@/server/session";
import { Cents, type Result } from "@/shared/kernel";
import { Alert } from "@/ui/form";
import { ManaStylesheet } from "@/ui/mana";
import { KeyruneStylesheet } from "@/ui/set-symbol";

// The Pack lab (design doc 05, section 10): open many packs of one booster, keep nothing, and
// compare what came out with what the recipe promises. The form uses GET, so a run is just a URL.

const PACK_COUNTS = [1, 10, 100, SIMULATION_LIMIT];

const COUNT_LABELS: Record<CountKey, string> = {
  common: "Commons",
  uncommon: "Uncommons",
  rare: "Rares",
  mythic: "Mythics",
  special: "Specials",
  bonus: "Bonus cards",
  foil: "Foils (any rarity)",
};

const ERROR_MESSAGES = {
  Forbidden: "Only admins can use the Pack lab.",
  BoosterUnavailable: "That booster isn't in the catalog.",
  CountInvalid: `Choose between 1 and ${SIMULATION_LIMIT} packs.`,
};

/** "play" → "Play booster", "collector-sample" → "Collector sample booster". */
function boosterLabel(boosterType: string): string {
  const words = boosterType.replaceAll("-", " ");
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} booster`;
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function PackLabPage(props: PageProps<"/admin/packs">) {
  const actor = await requireAdminActor();
  const searchParams = await props.searchParams;
  const { db, packs } = getContainer();
  const choices = await availableBoosters(db);

  // "BLB/play" → set BLB, booster type "play".
  const booster = firstValue(searchParams.booster) ?? "";
  const count = Number(firstValue(searchParams.count) ?? 10);
  const [setCode, boosterType] = booster.split("/", 2);

  let result: Result<SimulationReport, SimulateOpeningsError> | null = null;
  if (setCode && boosterType) {
    try {
      result = await packs.simulateOpenings(actor, {
        setCode: SetCode.of(setCode),
        boosterType,
        count,
      });
    } catch (error) {
      if (!(error instanceof RangeError)) throw error; // a malformed set code in the URL
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-12">
      <KeyruneStylesheet />
      <ManaStylesheet />
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Pack lab</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Open packs with the real odds to check a set&apos;s recipe. Nothing is kept and no money
          moves.
        </p>
      </header>

      <PackLabForm choices={choices} booster={booster} count={count} />

      {result !== null && !result.ok && (
        <Alert tone="error">{ERROR_MESSAGES[result.error.kind]}</Alert>
      )}
      {result !== null && result.ok && <Report report={result.value} choices={choices} />}
    </main>
  );
}

function PackLabForm(props: { choices: BoosterChoice[]; booster: string; count: number }) {
  if (props.choices.length === 0) {
    return <p className="text-sm text-zinc-500">No enabled set has booster recipes yet.</p>;
  }
  return (
    <form method="get" className="flex flex-wrap items-end gap-3 text-sm">
      <label className="flex flex-col gap-1">
        <span className="font-medium">Booster</span>
        <select
          name="booster"
          defaultValue={props.booster}
          required
          className="rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 dark:border-zinc-700"
        >
          <option value="" disabled>
            Choose a booster…
          </option>
          {props.choices.map((choice) => (
            <optgroup key={choice.setCode} label={`${choice.setName} (${choice.setCode})`}>
              {choice.boosterTypes.map((type) => (
                <option key={type} value={`${choice.setCode}/${type}`}>
                  {choice.setCode} · {boosterLabel(type)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-medium">Packs</span>
        <select
          name="count"
          defaultValue={String(PACK_COUNTS.includes(props.count) ? props.count : 10)}
          className="rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 dark:border-zinc-700"
        >
          {PACK_COUNTS.map((packCount) => (
            <option key={packCount} value={packCount}>
              {packCount.toLocaleString("en-US")}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        className="rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
      >
        Open packs
      </button>
    </form>
  );
}

function priceOf(card: PackCard, printing: PrintingCard | undefined): Cents {
  return printing?.prices[card.finish] ?? Cents.zero;
}

const FINISH_NAMES = { nonfoil: "", foil: "Foil ", etched: "Etched " };

async function Report(props: { report: SimulationReport; choices: BoosterChoice[] }) {
  const { report } = props;
  const { db } = getContainer();
  const shownIds = [
    ...report.bestPulls.map((pull) => pull.printingId),
    ...report.samplePacks.flatMap((pack) => pack.cards.map((card) => card.printingId)),
  ];
  const [cards, msrp] = await Promise.all([
    printingCards(db, shownIds),
    packMsrp(db, report.setCode, report.boosterType),
  ]);
  const setName =
    props.choices.find((choice) => choice.setCode === report.setCode)?.setName ?? report.setCode;
  const rows = COUNT_KEYS.filter((key) => report.expected[key] > 0 || report.observed[key] > 0);

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">
          {report.packCount.toLocaleString("en-US")} × {setName} {boosterLabel(report.boosterType)}
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {msrp === null
            ? "This pack isn't sold on its own. "
            : `A pack costs ${Cents.format(msrp)} (MSRP). `}
          Cards inside an average pack are worth{" "}
          <strong className="text-zinc-900 tabular-nums dark:text-zinc-100">
            {Cents.format(report.averageValue)}
          </strong>{" "}
          at market price. Seed <code className="text-xs">{report.seed}</code>
        </p>

        <table className="w-full max-w-lg text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
              <th className="py-1 font-medium">Per pack</th>
              <th className="py-1 text-right font-medium">Recipe says</th>
              <th className="py-1 text-right font-medium">We got</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((key) => (
              <tr key={key} className="border-b border-zinc-100 dark:border-zinc-900">
                <td className="py-1">{COUNT_LABELS[key]}</td>
                <td className="py-1 text-right tabular-nums">{report.expected[key].toFixed(3)}</td>
                <td className="py-1 text-right tabular-nums">{report.observed[key].toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {report.bestPulls.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Best pulls</h2>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {report.bestPulls.map((pull) => {
              const printing = cards.get(pull.printingId);
              if (printing === undefined) return null;
              return (
                <CardTile
                  key={`${pull.printingId}/${pull.finish}`}
                  printing={printing}
                  isFoil={pull.finish !== "nonfoil"}
                  priceLine={`${FINISH_NAMES[pull.finish]}${Cents.format(pull.price)} · pulled ${pull.timesPulled}×`}
                />
              );
            })}
          </ul>
        </section>
      )}

      {report.samplePacks.map((pack, index) => (
        <SamplePack key={pack.seed} pack={pack} number={index + 1} cards={cards} />
      ))}
    </div>
  );
}

function SamplePack(props: { pack: Pack; number: number; cards: Map<string, PrintingCard> }) {
  const { pack, cards } = props;
  const value = Cents.sum(pack.cards.map((card) => priceOf(card, cards.get(card.printingId))));
  return (
    <section className="flex flex-col gap-3" aria-label={`Pack ${props.number}`}>
      <h2 className="text-lg font-medium">
        Pack {props.number}{" "}
        <span className="text-sm font-normal text-zinc-500">
          {pack.cards.length} cards in reveal order · worth {Cents.format(value)}
        </span>
      </h2>
      <ol className="grid grid-cols-3 gap-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8">
        {pack.cards.map((card, position) => {
          const printing = cards.get(card.printingId);
          if (printing === undefined) return null;
          return (
            <CardTile
              key={position}
              printing={printing}
              isFoil={card.finish !== "nonfoil"}
              priceLine={`${FINISH_NAMES[card.finish]}${Cents.format(priceOf(card, printing))}`}
            />
          );
        })}
      </ol>
    </section>
  );
}
