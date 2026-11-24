import {
  buildFooter,
  buildTitleBar,
  buildTypeBar,
  EMPTY_FRAGMENT,
  LAYOUT,
  mergeFragments,
  placeFlowedInBox,
  type DrawingFragment,
  type RotatedSection,
} from "./playtest-chrome";
import type { FrameInput, FrameResult } from "./playtest-layouts";
import type { PrintedFace } from "./playtest-card";
import {
  fitParagraphs,
  fittingFlow,
  fittingSize,
  flow,
  paragraphsOf,
  statsOf,
  TEXT_SIZES,
  type Measure,
  type Paragraph,
} from "./playtest-text";
import type { Box } from "./proxy-sheet";

// Multi-face-on-one-side frame layouts: Adventure/Omen, Split/Room/Aftermath, and Kamigawa Flip.

export type InsetSpellOptions = Readonly<{
  insetSide: "left" | "right";
}>;

/**
 * Inset-spell frame for Adventure/Omen (inset spell on the left) and Prepare (inset spell on the
 * right): main creature title, art and type line on top; side-by-side panels below.
 */
export function insetSpellFrame(input: FrameInput, options: InsetSpellOptions): FrameResult {
  const { card, faces, frame, style, measure } = input;
  const main = faces[0] ?? card.faces[0];
  const spell = faces[1] ?? main;
  const innerX = frame.x + LAYOUT.margin;
  const innerWidth = frame.width - 2 * LAYOUT.margin;
  const top = frame.y + frame.height;

  const titleBox: Box = {
    x: innerX,
    y: top - LAYOUT.margin - LAYOUT.titleHeight,
    width: innerWidth,
    height: LAYOUT.titleHeight,
  };
  const title = buildTitleBar(titleBox, main, {}, measure);
  const footer = buildFooter(frame, innerX, innerWidth, card, main, measure);
  const bodyTop = titleBox.y - LAYOUT.gap;
  const bodyBottom = footer.bodyBottom;

  const spellWidth = Math.floor((innerWidth - LAYOUT.gap) * 0.47);
  const mainWidth = innerWidth - LAYOUT.gap - spellWidth;
  const spellHeaderHeight = 12;
  const spellTypeHeight = 10;
  const spellChrome = spellHeaderHeight + spellTypeHeight + 2;
  const spellTextWidth = spellWidth - 2 * LAYOUT.padding;
  const mainTextWidth = mainWidth - 2 * LAYOUT.padding;
  const spellParagraphs = paragraphsOf(spell?.text ?? "");
  const mainParagraphs = paragraphsOf(main?.text ?? "");

  const panelHeightWith = (artHeight: number) =>
    bodyTop -
    bodyBottom -
    LAYOUT.typeHeight -
    LAYOUT.gap -
    (artHeight > 0 ? artHeight + LAYOUT.gap : 0);

  let artHeight = style.art ? LAYOUT.artHeight : 0;
  const currentPanel = panelHeightWith(artHeight);
  const spellFits =
    currentPanel - spellChrome - 2 * LAYOUT.padding > 0 &&
    fittingFlow(
      spellParagraphs,
      spellTextWidth,
      currentPanel - spellChrome - 2 * LAYOUT.padding,
      measure,
      TEXT_SIZES.largest,
      TEXT_SIZES.smallest,
    ) !== null;
  const mainFits =
    currentPanel - 2 * LAYOUT.padding > 0 &&
    fittingFlow(
      mainParagraphs,
      mainTextWidth,
      currentPanel - 2 * LAYOUT.padding,
      measure,
      TEXT_SIZES.largest,
      TEXT_SIZES.smallest,
    ) !== null;

  if (!spellFits || !mainFits) {
    const neededSpell =
      flow(spellParagraphs, spellTextWidth, TEXT_SIZES.smallest, measure).height +
      spellChrome +
      2 * LAYOUT.padding;
    const neededMain =
      flow(mainParagraphs, mainTextWidth, TEXT_SIZES.smallest, measure).height + 2 * LAYOUT.padding;
    const shrunk = artHeight - Math.max(0, Math.max(neededSpell, neededMain) - currentPanel);
    artHeight = shrunk >= LAYOUT.smallestArt ? shrunk : 0;
  }

  const art: Box | null =
    artHeight > 0
      ? { x: innerX, y: bodyTop - artHeight, width: innerWidth, height: artHeight }
      : null;
  const typeBox: Box = {
    x: innerX,
    y: (art === null ? bodyTop : art.y - LAYOUT.gap) - LAYOUT.typeHeight,
    width: innerWidth,
    height: LAYOUT.typeHeight,
  };
  const typeBar = buildTypeBar(
    typeBox,
    main?.typeLine ?? "",
    { setIcon: { setCode: card.setCode, rarity: card.rarity } },
    measure,
  );

  const panelHeight = typeBox.y - LAYOUT.gap - bodyBottom;
  const spellOnLeft = options.insetSide === "left";
  const spellBox: Box = {
    x: spellOnLeft ? innerX : innerX + mainWidth + LAYOUT.gap,
    y: bodyBottom,
    width: spellWidth,
    height: panelHeight,
  };
  const mainBox: Box = {
    x: spellOnLeft ? innerX + spellWidth + LAYOUT.gap : innerX,
    y: bodyBottom,
    width: mainWidth,
    height: panelHeight,
  };
  const spellHeaderBox: Box = {
    x: spellBox.x,
    y: spellBox.y + spellBox.height - spellHeaderHeight,
    width: spellBox.width,
    height: spellHeaderHeight,
  };
  const spellHeader = buildTitleBar(
    spellHeaderBox,
    spell,
    { symbolDiameter: 6.5, maxNameSize: 7 },
    measure,
  );
  const spellTypeY = spellHeaderBox.y - spellTypeHeight;
  const spellTypeLine = spell?.typeLine ?? "";
  const spellTypeSize = fittingSize(spellTypeLine, "italic", spellTextWidth, 6, 3.8, measure);
  const spellType: DrawingFragment = {
    panels: [],
    texts: [
      {
        text: spellTypeLine,
        x: spellBox.x + LAYOUT.padding,
        y: spellTypeY + spellTypeHeight / 2 - spellTypeSize * 0.36,
        size: spellTypeSize,
        font: "italic",
      },
    ],
    symbols: [],
    setIcons: [],
    rules: [
      {
        from: { x: spellBox.x + LAYOUT.padding, y: spellTypeY },
        to: { x: spellBox.x + spellBox.width - LAYOUT.padding, y: spellTypeY },
      },
    ],
  };
  const spellBodyBox: Box = {
    x: spellBox.x,
    y: spellBox.y,
    width: spellBox.width,
    height: Math.max(0, spellTypeY - spellBox.y),
  };

  return {
    art,
    fragment: mergeFragments(
      title,
      footer.fragment,
      typeBar,
      { panels: [spellBox, mainBox], texts: [], symbols: [], setIcons: [], rules: [] },
      spellHeader,
      spellType,
      placeFlowedInBox(
        spellBodyBox,
        fitParagraphs(
          spellParagraphs,
          spellTextWidth,
          spellBodyBox.height - 2 * LAYOUT.padding,
          measure,
        ),
      ),
      placeFlowedInBox(
        mainBox,
        fitParagraphs(mainParagraphs, mainTextWidth, mainBox.height - 2 * LAYOUT.padding, measure),
      ),
    ),
    rotatedSections: [],
  };
}

/** Builds one compact half-card (title + cost, type + stats, rules box) inside `box`. */
function buildHalfCard(
  box: Box,
  face: PrintedFace,
  paragraphs: readonly Paragraph[],
  setIcon: Readonly<{ setCode: string; rarity: string }>,
  measure: Measure,
): DrawingFragment {
  const titleBox: Box = {
    x: box.x,
    y: box.y + box.height - LAYOUT.halfTitleHeight,
    width: box.width,
    height: LAYOUT.halfTitleHeight,
  };
  const typeBox: Box = {
    x: box.x,
    y: titleBox.y - LAYOUT.halfGap - LAYOUT.halfTypeHeight,
    width: box.width,
    height: LAYOUT.halfTypeHeight,
  };
  const textBox: Box = {
    x: box.x,
    y: box.y,
    width: box.width,
    height: Math.max(0, typeBox.y - LAYOUT.halfGap - box.y),
  };
  const flowed = fitParagraphs(
    paragraphs,
    textBox.width - 2 * LAYOUT.padding,
    textBox.height - 2 * LAYOUT.padding,
    measure,
  );
  return mergeFragments(
    buildTitleBar(titleBox, face, { symbolDiameter: 7.5, maxNameSize: 8 }, measure),
    buildTypeBar(typeBox, face.typeLine, { stats: statsOf(face), setIcon, maxSize: 6.5 }, measure),
    { panels: [textBox], texts: [], symbols: [], setIcons: [], rules: [] },
    placeFlowedInBox(textBox, flowed),
  );
}

export type TwoHalfOptions = Readonly<{
  defaultArtHeight: number;
  bottomOrientation: "upright" | "rotated180";
}>;

/** Two-half stacked frame for Split/Room/Aftermath (upright) and Kamigawa Flip (rotated 180°). */
export function twoHalfFrame(input: FrameInput, options: TwoHalfOptions): FrameResult {
  const { card, faces, frame, style, measure } = input;
  const topFace = faces[0] ?? card.faces[0];
  const bottomFace = faces[1] ?? topFace;
  const innerX = frame.x + LAYOUT.margin;
  const innerWidth = frame.width - 2 * LAYOUT.margin;
  const bodyTop = frame.y + frame.height - LAYOUT.margin;
  const footer = buildFooter(frame, innerX, innerWidth, card, undefined, measure);
  const bodyBottom = footer.bodyBottom;

  const totalHeight = bodyTop - bodyBottom;
  const textWidth = innerWidth - 2 * LAYOUT.padding;
  const topParagraphs = paragraphsOf(topFace?.text ?? "");
  const bottomParagraphs = paragraphsOf(bottomFace?.text ?? "");
  const halfChrome =
    LAYOUT.halfTitleHeight + LAYOUT.halfTypeHeight + 2 * LAYOUT.halfGap + 2 * LAYOUT.padding;

  const textHeightFor = (artHeight: number) =>
    (totalHeight - (artHeight > 0 ? artHeight + 2 * LAYOUT.gap : LAYOUT.gap)) / 2 - halfChrome;

  let artHeight = style.art ? options.defaultArtHeight : 0;
  const textHeight = textHeightFor(artHeight);
  const bothFit =
    textHeight > 0 &&
    fittingFlow(
      topParagraphs,
      textWidth,
      textHeight,
      measure,
      TEXT_SIZES.largest,
      TEXT_SIZES.smallest,
    ) !== null &&
    fittingFlow(
      bottomParagraphs,
      textWidth,
      textHeight,
      measure,
      TEXT_SIZES.largest,
      TEXT_SIZES.smallest,
    ) !== null;

  if (!bothFit) {
    const needed = Math.max(
      flow(topParagraphs, textWidth, TEXT_SIZES.smallest, measure).height,
      flow(bottomParagraphs, textWidth, TEXT_SIZES.smallest, measure).height,
    );
    const shrunk = artHeight - 2 * Math.max(0, needed - textHeight);
    artHeight = shrunk >= LAYOUT.smallestArt ? shrunk : 0;
  }

  const halfHeight = (totalHeight - (artHeight > 0 ? artHeight + 2 * LAYOUT.gap : LAYOUT.gap)) / 2;
  const topHalfBox: Box = {
    x: innerX,
    y: bodyTop - halfHeight,
    width: innerWidth,
    height: halfHeight,
  };
  const art: Box | null =
    artHeight > 0
      ? {
          x: innerX,
          y: topHalfBox.y - LAYOUT.gap - artHeight,
          width: innerWidth,
          height: artHeight,
        }
      : null;
  const bottomHalfBox: Box = { x: innerX, y: bodyBottom, width: innerWidth, height: halfHeight };

  const setIcon = { setCode: card.setCode, rarity: card.rarity };
  const topHalf =
    topFace === undefined
      ? EMPTY_FRAGMENT
      : buildHalfCard(topHalfBox, topFace, topParagraphs, setIcon, measure);
  const bottomHalf =
    bottomFace === undefined
      ? EMPTY_FRAGMENT
      : buildHalfCard(bottomHalfBox, bottomFace, bottomParagraphs, setIcon, measure);

  if (options.bottomOrientation === "rotated180") {
    const rotatedSection: RotatedSection = {
      center: {
        x: bottomHalfBox.x + bottomHalfBox.width / 2,
        y: bottomHalfBox.y + bottomHalfBox.height / 2,
      },
      ...bottomHalf,
    };
    return {
      art,
      fragment: mergeFragments(footer.fragment, topHalf),
      rotatedSections: [rotatedSection],
    };
  }

  return {
    art,
    fragment: mergeFragments(footer.fragment, topHalf, bottomHalf),
    rotatedSections: [],
  };
}
