import { Cents } from "@/shared/kernel";
import { fits, ownedToward, type CopyKind, type OwnedStack, type Wish } from "./wish";

// What the Wishlist page shows for each wish (design doc 26, section 9): the printing it would
// buy today, how far your money is from it, and the order to show them in. Pure: the query
// gathers the rows, these functions decide.

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

/** One printing for sale in one finish, at its latest market price. */
export type Offer = CopyKind &
  Readonly<{
    name: string;
    setCode: string;
    setName: string;
    collectorNumber: string;
    /** "Showcase", "Borderless · Galaxy Foil", or "" for a regular printing. */
    variantLabel: string;
    releaseDate: string;
    price: Cents;
  }>;

/** Everything the page needs to know about the wishes, gathered by one query. */
export type WishlistAnswers = Readonly<{
  wishes: readonly Wish[];
  /** Card names by oracle id, for wishes with nothing for sale. */
  names: ReadonlyMap<string, string>;
  /** Every printing for sale of every wished card, in every finish. */
  forSale: readonly Offer[];
  /** What the player owns of the wished cards. */
  owned: readonly OwnedStack[];
}>;

/** The money side: your balance and, when allowances are on, when the next ones come. */
export type WalletOutlook = Readonly<{
  balance: Cents;
  /** Paid every payday; 0 when allowances are off. */
  allowance: Cents;
  allowancePeriodDays: number;
  nextPayday: Date;
}>;

export type WishStatus =
  | Readonly<{ kind: "fulfilled" }>
  | Readonly<{ kind: "notForSale" }>
  | Readonly<{ kind: "affordable" }>
  | Readonly<{
      kind: "shortBy";
      shortfall: Cents;
      /** Section 3.2; null when allowances are off. */
      paydays: Paydays | null;
    }>;

export type Paydays = Readonly<{ count: number; date: Date }>;

export type WishLine = Readonly<{
  wish: Wish;
  name: string;
  /** The printing it would buy today, or null when none is for sale. */
  offer: Offer | null;
  /** Every printing for sale that fills the wish, best first (the page's menu). */
  options: readonly Offer[];
  owned: number;
  /** Copies still to get: quantity − owned, at least 0. */
  missing: number;
  /** The offer's price for the missing copies. */
  total: Cents | null;
  /** Per copy: today's offer less the saved price. Negative means cheaper. */
  changeSinceSaved: Cents | null;
  /** The offer is at or under the target price (never for a fulfilled wish). */
  atTarget: boolean;
  status: WishStatus;
}>;

/** Cheapest first; at the same price, the newer printing (the same order as Buy a list). */
export function bestFirst(a: Offer, b: Offer): number {
  return a.price - b.price || b.releaseDate.localeCompare(a.releaseDate);
}

/** Printings for sale that fill the wish, best first. */
export function offersFor(wish: Pick<Wish, "target">, forSale: readonly Offer[]): Offer[] {
  return forSale.filter((offer) => fits(wish.target, offer)).sort(bestFirst);
}

/**
 * Section 3.2: how many paydays until the allowance covers the shortfall, and the date of the
 * last of them, if nothing else is spent and prices stay put. Null when allowances are off.
 */
export function paydaysToGo(shortfall: Cents, outlook: WalletOutlook): Paydays | null {
  if (outlook.allowance <= 0) return null;
  const count = Math.max(1, Math.ceil(shortfall / outlook.allowance));
  const period = outlook.allowancePeriodDays * DAY_IN_MILLISECONDS;
  return { count, date: new Date(outlook.nextPayday.getTime() + (count - 1) * period) };
}

function statusFor(missing: number, total: Cents | null, outlook: WalletOutlook): WishStatus {
  if (missing === 0) return { kind: "fulfilled" };
  if (total === null) return { kind: "notForSale" };
  if (total <= outlook.balance) return { kind: "affordable" };
  const shortfall = Cents.subtract(total, outlook.balance);
  return { kind: "shortBy", shortfall, paydays: paydaysToGo(shortfall, outlook) };
}

/** One wish's line. */
export function wishLine(
  wish: Wish,
  answers: Omit<WishlistAnswers, "wishes">,
  outlook: WalletOutlook,
): WishLine {
  const options = offersFor(wish, answers.forSale);
  const offer = options[0] ?? null;
  const owned = ownedToward(wish.target, answers.owned);
  const missing = Math.max(0, wish.quantity - owned);
  const total = offer === null ? null : Cents.of(offer.price * missing);
  return {
    wish,
    name: offer?.name ?? answers.names.get(wish.target.oracleId) ?? "Unknown card",
    offer,
    options,
    owned,
    missing,
    total,
    changeSinceSaved:
      offer === null || wish.savedPrice === null
        ? null
        : Cents.subtract(offer.price, wish.savedPrice),
    atTarget:
      missing > 0 && offer !== null && wish.targetPrice !== null && offer.price <= wish.targetPrice,
    status: statusFor(missing, total, outlook),
  };
}

const STATUS_ORDER: Record<WishStatus["kind"], number> = {
  affordable: 0,
  shortBy: 1,
  notForSale: 2,
  fulfilled: 3,
};

function shortfallOf(line: WishLine): number {
  return line.status.kind === "shortBy" ? line.status.shortfall : 0;
}

/**
 * Section 9's order: at target first, then affordable, then the smallest shortfall, then not
 * for sale, with fulfilled wishes last. Ties go to the newest wish.
 */
export function byPriority(a: WishLine, b: WishLine): number {
  return (
    Number(b.atTarget) - Number(a.atTarget) ||
    STATUS_ORDER[a.status.kind] - STATUS_ORDER[b.status.kind] ||
    shortfallOf(a) - shortfallOf(b) ||
    b.wish.createdAt.getTime() - a.wish.createdAt.getTime()
  );
}

/** Every wish's line, in the page's order. */
export function wishLines(answers: WishlistAnswers, outlook: WalletOutlook): WishLine[] {
  return answers.wishes.map((wish) => wishLine(wish, answers, outlook)).sort(byPriority);
}

/** The header badge: wishes still wanted whose best offer is at or under their target. */
export function countAtTarget(answers: WishlistAnswers): number {
  const noMoney: WalletOutlook = {
    balance: Cents.zero,
    allowance: Cents.zero,
    allowancePeriodDays: 1,
    nextPayday: new Date(0),
  };
  return answers.wishes.filter((wish) => wishLine(wish, answers, noMoney).atTarget).length;
}

export type WishlistTotals = Readonly<{
  /** Everything still missing that's for sale. */
  all: Cents;
  /** The wishes your balance covers, each on its own. */
  affordable: Cents;
}>;

export function totals(lines: readonly WishLine[]): WishlistTotals {
  const sum = (kept: readonly WishLine[]) =>
    Cents.sum(kept.map((line) => line.total ?? Cents.zero));
  return {
    all: sum(lines.filter((line) => line.missing > 0)),
    affordable: sum(lines.filter((line) => line.status.kind === "affordable")),
  };
}
