"use client";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import type { PrintingCard } from "@/modules/catalog";
import type { CollectionRow, CollectionVariant } from "@/modules/collection";
import { useCardPreviewGroup } from "@/app/_components/card-preview-group";
import { payoutPerCopy } from "@/modules/store/client";
import { Cents } from "@/shared/kernel";
import type { Finish } from "@/shared/mtg";
import { Button } from "@/ui/button";
import { Dialog } from "@/ui/dialog";
import { Alert } from "@/ui/form";
import { findDuplicatesToSellAction, sellCartAction, type SellCartItem } from "./actions";
import { CollectionCardGrid } from "./card-grid";
import { setSellCart, useSellCart } from "./sell-cart-store";

const STAGED_STEPPER_CLASS = [
  "border-warning-line bg-warning-soft text-warning-ink",
  "flex items-center justify-between rounded-md border px-1.5 py-0.5 text-xs",
].join(" ");

const QUICK_SELL_CLASS = [
  "border-line text-muted hover:text-foreground",
  "w-full rounded-md border px-2 py-0.5 text-left text-[11px] font-medium tabular-nums",
].join(" ");

const STICKY_BAR_CLASS = [
  "border-line bg-background/95 fixed inset-x-4 bottom-4 z-40 mx-auto max-w-4xl",
  "flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 shadow-xl",
].join(" ");

function itemKey(printingId: string, finish: Finish): string {
  return `${printingId}/${finish}`;
}

function StackSellButton(props: { printingId: string; label: string; className: string }) {
  const previewGroup = useCardPreviewGroup();
  return (
    <button
      type="button"
      onClick={() => previewGroup?.openCard(props.printingId)}
      className={props.className}
    >
      {props.label}
    </button>
  );
}

type CollectionSellWorkspaceProps = {
  rows: readonly CollectionRow[];
  cardsById: Readonly<Record<string, PrintingCard>>;
  notesByPrinting: Readonly<Record<string, string>>;
  buylistRateBps: number;
  showSetCode?: boolean;
};

export function CollectionSellWorkspace(props: CollectionSellWorkspaceProps) {
  const { rows, cardsById, notesByPrinting, buylistRateBps, showSetCode } = props;
  const cart = useSellCart();

  const [keep, setKeep] = useState<1 | 4>(1);
  const [protectInDecks, setProtectInDecks] = useState(true);
  const [keepFoils, setKeepFoils] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [isFinding, startFinding] = useTransition();
  const [isSelling, startSelling] = useTransition();

  const cardsMap = useMemo(() => new Map(Object.entries(cardsById)), [cardsById]);
  const cartByKey = useMemo(
    () => new Map(cart.map((item) => [itemKey(item.printingId, item.finish), item])),
    [cart],
  );
  const totalCards = useMemo(() => cart.reduce((sum, item) => sum + item.quantity, 0), [cart]);
  const totalPayoutCents = useMemo(
    () => cart.reduce((sum, item) => sum + item.unitPayoutCents * item.quantity, 0),
    [cart],
  );

  const canBuy = buylistRateBps > 0;
  const buylistPct = Math.round(buylistRateBps / 100);

  function addDuplicates() {
    setNotice(null);
    startFinding(async () => {
      const result = await findDuplicatesToSellAction({ keep, protectInDecks, keepFoils });
      if (result.items.length === 0) {
        const suffix =
          result.skippedUnpriced > 0 ? ` (${result.skippedUnpriced} had $0.00 buylist value.)` : "";
        setNotice({
          tone: "error",
          text: `No sellable duplicates found keeping ${keep}${protectInDecks ? " + deck copies" : ""}.${suffix}`,
        });
        return;
      }

      setSellCart((previous) => {
        const merged = new Map(
          previous.map((item) => [itemKey(item.printingId, item.finish), item]),
        );
        for (const item of result.items) {
          merged.set(itemKey(item.printingId, item.finish), item);
        }
        return [...merged.values()].sort(
          (a, b) => b.unitPayoutCents * b.quantity - a.unitPayoutCents * a.quantity,
        );
      });

      const stagedCopies = result.items.reduce((sum, item) => sum + item.quantity, 0);
      const stagedTotal = result.items.reduce(
        (sum, item) => sum + item.unitPayoutCents * item.quantity,
        0,
      );
      const skippedText =
        result.skippedUnpriced > 0 ? ` (${result.skippedUnpriced} with $0.00 value skipped)` : "";
      setNotice({
        tone: "success",
        text: `Added ${stagedCopies} duplicate ${stagedCopies === 1 ? "copy" : "copies"} (${Cents.format(Cents.of(stagedTotal))}) to your sell cart.${skippedText}`,
      });
    });
  }

  function upsertVariant(variant: CollectionVariant, printing: PrintingCard, quantity: number) {
    if (variant.price === null) return;
    const unitPayoutCents = Number(payoutPerCopy(Cents.of(variant.price), buylistRateBps));
    if (unitPayoutCents <= 0) return;
    const key = itemKey(variant.printingId, variant.finish);
    setSellCart((previous) => {
      if (quantity <= 0) {
        return previous.filter((item) => itemKey(item.printingId, item.finish) !== key);
      }
      const nextItem: SellCartItem = {
        printingId: variant.printingId,
        finish: variant.finish,
        name: printing.name,
        setCode: printing.setCode,
        collectorNumber: printing.collectorNumber,
        rarity: printing.rarity,
        owned: variant.quantity,
        quantity: Math.min(quantity, variant.quantity),
        unitPayoutCents,
        deckNote: notesByPrinting[variant.printingId],
      };
      const exists = previous.some((item) => itemKey(item.printingId, item.finish) === key);
      if (exists) {
        return previous.map((item) =>
          itemKey(item.printingId, item.finish) === key ? nextItem : item,
        );
      }
      return [nextItem, ...previous];
    });
  }

  function setItemQuantity(key: string, quantity: number) {
    setSellCart((previous) => {
      if (quantity <= 0) {
        return previous.filter((item) => itemKey(item.printingId, item.finish) !== key);
      }
      return previous.map((item) =>
        itemKey(item.printingId, item.finish) === key
          ? { ...item, quantity: Math.min(quantity, item.owned) }
          : item,
      );
    });
  }

  function confirmSell() {
    if (cart.length === 0) return;
    setNotice(null);
    startSelling(async () => {
      const result = await sellCartAction({
        lines: cart.map((item) => ({
          printingId: item.printingId,
          finish: item.finish,
          quantity: item.quantity,
        })),
        expectedTotal: totalPayoutCents,
      });
      if (result.ok) {
        setSellCart(() => []);
        setDrawerOpen(false);
        setNotice({ tone: "success", text: result.message });
      } else {
        setNotice({ tone: "error", text: result.message });
      }
    });
  }

  function renderVariantFooter(variant: CollectionVariant, printing: PrintingCard) {
    if (!canBuy || variant.price === null) return null;
    const unitPayout = Number(payoutPerCopy(Cents.of(variant.price), buylistRateBps));
    if (unitPayout <= 0) return null;

    const staged = cartByKey.get(itemKey(variant.printingId, variant.finish));
    if (staged) {
      return (
        <div className={STAGED_STEPPER_CLASS}>
          <button
            type="button"
            onClick={() => upsertVariant(variant, printing, staged.quantity - 1)}
            aria-label={`Remove one ${printing.name} from sell cart`}
            className="rounded px-1.5 font-bold"
          >
            −
          </button>
          <span className="font-medium tabular-nums">
            Sell {staged.quantity}/{variant.quantity}
          </span>
          <button
            type="button"
            onClick={() => upsertVariant(variant, printing, staged.quantity + 1)}
            disabled={staged.quantity >= variant.quantity}
            aria-label={`Add one more ${printing.name} to sell cart`}
            className="rounded px-1.5 font-bold disabled:opacity-40"
          >
            +
          </button>
        </div>
      );
    }

    const extras = variant.quantity > keep ? variant.quantity - keep : 1;
    const label =
      variant.quantity > keep
        ? `Sell ${extras} extra (${Cents.format(Cents.of(unitPayout * extras))})`
        : `Sell (${Cents.format(Cents.of(unitPayout))})`;

    return (
      <button
        type="button"
        onClick={() => upsertVariant(variant, printing, extras)}
        className={QUICK_SELL_CLASS}
      >
        + {label}
      </button>
    );
  }

  function renderCardFooter(row: CollectionRow, printing: PrintingCard) {
    if (!canBuy) return null;
    const variants = row.variants;
    if (variants === undefined || variants.length <= 1) {
      return renderVariantFooter(
        variants?.[0] ?? {
          printingId: row.printingId,
          finish: row.finish,
          quantity: row.quantity,
          price: row.price,
        },
        printing,
      );
    }

    const stagedCopies = variants.reduce(
      (sum, variant) =>
        sum + (cartByKey.get(itemKey(variant.printingId, variant.finish))?.quantity ?? 0),
      0,
    );
    if (stagedCopies > 0) {
      return (
        <StackSellButton
          printingId={row.printingId}
          label={`Selling ${stagedCopies}/${row.quantity} · Printings`}
          className={`${STAGED_STEPPER_CLASS} w-full cursor-pointer justify-center font-medium tabular-nums`}
        />
      );
    }

    const hasSellable = variants.some(
      (variant) =>
        variant.price !== null &&
        Number(payoutPerCopy(Cents.of(variant.price), buylistRateBps)) > 0,
    );
    if (!hasSellable) return null;

    return (
      <StackSellButton
        printingId={row.printingId}
        label={`+ Sell (${variants.length} versions)…`}
        className={`${QUICK_SELL_CLASS} cursor-pointer`}
      />
    );
  }

  return (
    <div className={`flex flex-col gap-5 ${cart.length > 0 ? "pb-20" : ""}`}>
      {canBuy && (
        <section
          aria-label="Sell duplicates"
          className="border-border-subtle bg-surface/50 flex flex-col gap-3 rounded-lg border p-3"
        >
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={addDuplicates} disabled={isFinding}>
              {isFinding ? "Finding duplicates…" : "Add duplicates to sell cart"}
            </Button>
            <div className="border-line inline-flex overflow-hidden rounded-md border text-xs">
              {([1, 4] as const).map((option, idx) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setKeep(option)}
                  aria-pressed={keep === option}
                  className={`px-2.5 py-1 font-medium ${idx > 0 ? "border-line border-l" : ""} ${
                    keep === option ? "bg-accent text-accent-foreground" : "text-muted"
                  }`}
                >
                  Keep {option}
                </button>
              ))}
            </div>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={protectInDecks}
                onChange={(event) => setProtectInDecks(event.target.checked)}
              />
              Protect copies in decks
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={keepFoils}
                onChange={(event) => setKeepFoils(event.target.checked)}
              />
              Keep foils
            </label>
            <span className="text-muted ml-auto text-xs">Buylist pays {buylistPct}% of market</span>
          </div>
          {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
        </section>
      )}

      {rows.length === 0 ? (
        <p className="text-muted text-sm">
          No cards here.{" "}
          <Link href="/store" className="underline">
            Buy a pack
          </Link>{" "}
          or{" "}
          <Link href="/singles" className="underline">
            a single
          </Link>
          .
        </p>
      ) : (
        <CollectionCardGrid
          rows={rows}
          cards={cardsMap}
          showSetCode={showSetCode}
          noteFor={(printingId) => notesByPrinting[printingId]}
          footerFor={canBuy ? renderCardFooter : undefined}
          variantFooterFor={canBuy ? renderVariantFooter : undefined}
        />
      )}

      {cart.length > 0 && (
        <aside aria-label="Sell cart" className={STICKY_BAR_CLASS}>
          <div className="flex flex-col text-sm">
            <span className="font-semibold tabular-nums">
              {totalCards} {totalCards === 1 ? "card" : "cards"} in sell cart ({cart.length} unique)
            </span>
            <span className="text-muted text-xs tabular-nums">
              Estimated payout:{" "}
              <strong className="text-foreground">
                {Cents.format(Cents.of(totalPayoutCents))}
              </strong>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" onClick={() => setSellCart(() => [])}>
              Clear
            </Button>
            <Button type="button" onClick={() => setDrawerOpen(true)}>
              Review &amp; sell ({Cents.format(Cents.of(totalPayoutCents))})
            </Button>
          </div>
        </aside>
      )}

      <Dialog
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={`Sell cart (${totalCards} ${totalCards === 1 ? "card" : "cards"})`}
        size="lg"
        showCloseButton
      >
        {notice?.tone === "error" && <Alert tone="error">{notice.text}</Alert>}
        <ul className="divide-border-subtle divide-y text-sm">
          {cart.map((item) => {
            const key = itemKey(item.printingId, item.finish);
            const lineTotal = item.unitPayoutCents * item.quantity;
            return (
              <li key={key} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <Link href={`/cards/${item.printingId}`} className="font-medium hover:underline">
                    {item.name}
                  </Link>
                  <p className="text-muted text-xs">
                    {item.setCode} #{item.collectorNumber}
                    {item.finish !== "nonfoil" && ` · ${item.finish}`} ·{" "}
                    {Cents.format(Cents.of(item.unitPayoutCents))} each · own {item.owned}
                  </p>
                  {item.deckNote && (
                    <p className="text-xs text-sky-700 dark:text-sky-400">{item.deckNote}</p>
                  )}
                </div>
                <div className="border-line flex items-center rounded-md border text-xs">
                  <button
                    type="button"
                    onClick={() => setItemQuantity(key, item.quantity - 1)}
                    aria-label={`Decrease quantity for ${item.name}`}
                    className="hover:bg-surface px-2 py-1 font-bold"
                  >
                    −
                  </button>
                  <span className="px-2 tabular-nums">{item.quantity}</span>
                  <button
                    type="button"
                    onClick={() => setItemQuantity(key, item.quantity + 1)}
                    disabled={item.quantity >= item.owned}
                    aria-label={`Increase quantity for ${item.name}`}
                    className="hover:bg-surface px-2 py-1 font-bold disabled:opacity-40"
                  >
                    +
                  </button>
                </div>
                <span className="w-16 text-right font-medium tabular-nums">
                  {Cents.format(Cents.of(lineTotal))}
                </span>
                <button
                  type="button"
                  onClick={() => setItemQuantity(key, 0)}
                  aria-label={`Remove ${item.name}`}
                  className="text-muted hover:text-danger-text text-xs underline"
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
        <div className="border-border-subtle flex flex-wrap items-center justify-between gap-3 border-t pt-3">
          <div className="text-sm">
            Total payout:{" "}
            <strong className="tabular-nums">{Cents.format(Cents.of(totalPayoutCents))}</strong>
            <p className="text-muted text-xs">
              These cards leave your collection and the payout is added to your wallet.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" onClick={() => setSellCart(() => [])}>
              Clear cart
            </Button>
            <Button type="button" onClick={confirmSell} disabled={isSelling}>
              {isSelling ? "Selling…" : `Sell all for ${Cents.format(Cents.of(totalPayoutCents))}`}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
