import { CardPreviewGroup, type CardPreviewItem } from "@/app/_components/card-preview-group";
import type { CardPreviewVariant } from "@/app/_components/card-preview";
import { CardTile } from "@/app/_components/card-tile";
import type { PrintingCard } from "@/modules/catalog";
import type { CollectionRow, CollectionVariant } from "@/modules/collection";
import { Cents } from "@/shared/kernel";
import { FINISH_NAMES, sectionsOf } from "@/app/collection/options";

const STACK_BADGE_CLASS =
  "rounded-full bg-black/80 px-2 py-0.5 text-[11px] font-medium text-white shadow ring-1 ring-white/15 backdrop-blur-xs";

function formatPrice(cents: number | null): string {
  return cents === null ? "no price" : Cents.format(Cents.of(cents));
}

function variantLabel(variant: CollectionVariant, printing: PrintingCard): string {
  const finish = FINISH_NAMES[variant.finish].trim();
  return [
    `${printing.setCode.toUpperCase()} #${printing.collectorNumber}`,
    finish || null,
    `${variant.quantity}×`,
    formatPrice(variant.price),
  ]
    .filter(Boolean)
    .join(" · ");
}

function stackBadgeText(variants: readonly CollectionVariant[]): string {
  const distinctPrintings = new Set(variants.map((v) => v.printingId)).size;
  return distinctPrintings > 1 ? `${distinctPrintings} printings` : `${variants.length} finishes`;
}

/**
 * A page of owned cards in sections: the Game and Real tabs' grid, and the real collection shown
 * read only to others. `noteFor` adds a line under a card (the game tab shows its decks).
 */
export function CollectionCardGrid(props: {
  rows: readonly CollectionRow[];
  cards: ReadonlyMap<string, PrintingCard>;
  /** Show each card's set code before its collector number (default true; false when sectioned by set). */
  showSetCode?: boolean;
  noteFor?: (printingId: string) => string | undefined;
  footerFor?: (row: CollectionRow, printing: PrintingCard) => React.ReactNode;
  variantFooterFor?: (variant: CollectionVariant, printing: PrintingCard) => React.ReactNode;
}) {
  const showSetCode = props.showSetCode ?? true;
  const sections = sectionsOf(props.rows);
  const previewCards: CardPreviewItem[] = sections.flatMap((section) =>
    section.rows.flatMap((row) => {
      const printing = props.cards.get(row.printingId);
      if (printing === undefined) return [];
      const rawVariants = row.variants ?? [
        {
          printingId: row.printingId,
          finish: row.finish,
          quantity: row.quantity,
          price: row.price,
        },
      ];
      const variants: CardPreviewVariant[] = rawVariants.flatMap((variant) => {
        const variantPrinting = props.cards.get(variant.printingId);
        if (variantPrinting === undefined) return [];
        return [
          {
            key: `${variant.printingId}/${variant.finish}`,
            printing: variantPrinting,
            href: `/cards/${variant.printingId}`,
            label: variantLabel(variant, variantPrinting),
            note: props.noteFor?.(variant.printingId),
            footer: props.variantFooterFor?.(variant, variantPrinting),
          },
        ];
      });
      return [
        {
          printing,
          href: `/cards/${row.printingId}`,
          variants: variants.length > 0 ? variants : undefined,
        },
      ];
    }),
  );
  return (
    <CardPreviewGroup cards={previewCards}>
      <div className="flex flex-col gap-8">
        {sections.map((section) => (
          <section key={section.label || "all"} className="flex flex-col gap-3">
            {section.label && <h2 className="text-lg font-medium">{section.label}</h2>}
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {section.rows.map((row) => {
                const printing = props.cards.get(row.printingId);
                if (printing === undefined) return null;
                const variants = row.variants;
                const isStacked = variants !== undefined && variants.length > 1;
                const price = formatPrice(row.price);
                const topQuantity = variants?.[0]?.quantity ?? row.quantity;
                const otherCopies = row.quantity - topQuantity;
                const priceLine =
                  isStacked && otherCopies > 0
                    ? `${topQuantity}× (+${otherCopies}) · ${FINISH_NAMES[row.finish]}${price}`
                    : `${row.quantity}× · ${FINISH_NAMES[row.finish]}${price}`;
                const note =
                  props.noteFor?.(row.printingId) ??
                  variants?.map((v) => props.noteFor?.(v.printingId)).find(Boolean);
                return (
                  <CardTile
                    key={`${row.printingId}/${row.finish}`}
                    printing={printing}
                    isFoil={row.finish !== "nonfoil"}
                    showSetCode={showSetCode}
                    stacked={isStacked}
                    badge={
                      isStacked ? (
                        <span className={STACK_BADGE_CLASS}>{stackBadgeText(variants)}</span>
                      ) : undefined
                    }
                    href={`/cards/${row.printingId}`}
                    priceLine={priceLine}
                    note={note}
                    footer={props.footerFor?.(row, printing)}
                  />
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </CardPreviewGroup>
  );
}

/** The three export links of a collection; `path` is its export route. */
export function ExportLinks(props: { path: string }) {
  return (
    <>
      <a href={`${props.path}?format=moxfield`} className="underline">
        Moxfield CSV
      </a>{" "}
      ·{" "}
      <a href={`${props.path}?format=text`} className="underline">
        text list
      </a>{" "}
      ·{" "}
      <a href={`${props.path}?format=full`} className="underline">
        full CSV
      </a>
    </>
  );
}
