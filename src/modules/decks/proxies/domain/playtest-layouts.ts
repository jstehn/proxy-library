import { hasTypeWord } from "@/shared/mtg";
import type { CardSide, PlaytestStyle, PrintedCard, PrintedFace } from "./playtest-card";
import {
  buildDfcHintBar,
  buildFooter,
  buildTitleBar,
  buildTypeBar,
  dfcCueFor,
  EMPTY_FRAGMENT,
  LAYOUT,
  mergeFragments,
  placeFlowedInBox,
  tokenBadgeLabel,
  type DrawingFragment,
  type RotatedSection,
} from "./playtest-chrome";
import { insetSpellFrame, twoHalfFrame } from "./playtest-multiface";
import {
  fitParagraphs,
  fittingFlow,
  flow,
  paragraphsOf,
  TEXT_SIZES,
  type Measure,
} from "./playtest-text";
import type { Box } from "./proxy-sheet";

// Frame strategy registry for playtest proxies (Pattern 11: lookup table, not an if-chain).
// Every Magic card frame kind has one pure FrameLayout function producing immutable shapes.

export type CardFrameKind =
  "standard" | "token" | "adventure" | "prepare" | "split" | "flip" | "saga" | "class";

export type FrameInput = Readonly<{
  card: PrintedCard;
  side: CardSide;
  faces: readonly PrintedFace[];
  frame: Box;
  style: PlaytestStyle;
  measure: Measure;
}>;

export type FrameResult = Readonly<{
  art: Box | null;
  fragment: DrawingFragment;
  rotatedSections: readonly RotatedSection[];
}>;

export type FrameLayout = (input: FrameInput) => FrameResult;

/** Classifies a card side into its frame kind: the one place that interprets Scryfall layouts. */
export function classifyFrame(card: PrintedCard, faces: readonly PrintedFace[]): CardFrameKind {
  if (!card.doubleFaced && faces.length >= 2) {
    if (card.layout === "adventure") return "adventure";
    if (card.layout === "prepare") return "prepare";
    if (card.layout === "flip") return "flip";
    return "split";
  }
  if (card.isToken) return "token";
  const typeLine = faces[0]?.typeLine ?? "";
  if (card.layout === "saga" || hasTypeWord(typeLine, ["Saga"])) return "saga";
  if (
    card.layout === "class" ||
    card.layout === "case" ||
    hasTypeWord(typeLine, ["Class", "Case"])
  ) {
    return "class";
  }
  return "standard";
}

/** Shared outer chrome for single-face frames: title bar, footer, and optional DFC hint bar. */
function buildSingleFaceChrome(
  input: FrameInput,
  face: PrintedFace | undefined,
  options: Readonly<{ includeTokenBadge: boolean }>,
): Readonly<{
  chrome: DrawingFragment;
  innerX: number;
  innerWidth: number;
  bodyTop: number;
  bodyBottom: number;
}> {
  const { card, side, frame, measure } = input;
  const innerX = frame.x + LAYOUT.margin;
  const innerWidth = frame.width - 2 * LAYOUT.margin;
  const top = frame.y + frame.height;
  const cue = dfcCueFor(card, side);

  const titleBox: Box = {
    x: innerX,
    y: top - LAYOUT.margin - LAYOUT.titleHeight,
    width: innerWidth,
    height: LAYOUT.titleHeight,
  };
  const title = buildTitleBar(
    titleBox,
    face,
    {
      dfcIcon: cue?.icon,
      tokenBadge: options.includeTokenBadge ? tokenBadgeLabel(face?.typeLine ?? "") : undefined,
    },
    measure,
  );
  const footer = buildFooter(frame, innerX, innerWidth, card, face, measure);
  let bodyBottom = footer.bodyBottom;
  let hint = EMPTY_FRAGMENT;
  if (cue !== null && cue.otherFace !== null) {
    const hintBox: Box = { x: innerX, y: bodyBottom, width: innerWidth, height: LAYOUT.hintHeight };
    hint = buildDfcHintBar(hintBox, cue, measure);
    bodyBottom = hintBox.y + hintBox.height + LAYOUT.gap;
  }

  return {
    chrome: mergeFragments(title, footer.fragment, hint),
    innerX,
    innerWidth,
    bodyTop: titleBox.y - LAYOUT.gap,
    bodyBottom,
  };
}

/** Standard or token single-face vertical frame: title, art, type line, text box, footer/hint. */
function verticalSingleFaceFrame(
  input: FrameInput,
  mode: Readonly<{ kind: "standard" | "token" }>,
): FrameResult {
  const { card, faces, style, measure } = input;
  const face = faces[0] ?? card.faces[0];
  const isToken = mode.kind === "token";
  const { chrome, innerX, innerWidth, bodyTop, bodyBottom } = buildSingleFaceChrome(input, face, {
    includeTokenBadge: isToken,
  });

  const paragraphs = paragraphsOf(face?.text ?? "");
  const textWidth = innerWidth - 2 * LAYOUT.padding;
  const textHeightWith = (artHeight: number) =>
    bodyTop -
    bodyBottom -
    LAYOUT.typeHeight -
    LAYOUT.gap -
    (artHeight > 0 ? artHeight + LAYOUT.gap : 0) -
    2 * LAYOUT.padding;

  let artHeight = style.art ? LAYOUT.artHeight : 0;
  const artAndText = bodyTop - bodyBottom - LAYOUT.typeHeight - LAYOUT.gap;
  const textless = paragraphs.length === 0;
  if (isToken && style.art) {
    const textNeeds = textless
      ? 0
      : LAYOUT.gap +
        flow(paragraphs, textWidth, LAYOUT.tokenTextSize, measure).height +
        2 * LAYOUT.padding;
    artHeight = Math.max(artHeight, artAndText - textNeeds);
  }
  const hasTextBox = !(isToken && textless);

  let flowed = hasTextBox
    ? fittingFlow(
        paragraphs,
        textWidth,
        textHeightWith(artHeight),
        measure,
        TEXT_SIZES.largest,
        TEXT_SIZES.smallest,
      )
    : flow(paragraphs, textWidth, TEXT_SIZES.largest, measure);
  if (flowed === null) {
    const needed = flow(paragraphs, textWidth, TEXT_SIZES.smallest, measure);
    const shrunk = artHeight - (needed.height - textHeightWith(artHeight));
    artHeight = shrunk >= LAYOUT.smallestArt ? shrunk : 0;
    flowed = fitParagraphs(paragraphs, textWidth, textHeightWith(artHeight), measure);
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
    face?.typeLine ?? "",
    { setIcon: { setCode: card.setCode, rarity: card.rarity } },
    measure,
  );
  const textBox: Box = {
    x: innerX,
    y: bodyBottom,
    width: innerWidth,
    height: Math.max(0, typeBox.y - LAYOUT.gap - bodyBottom),
  };
  const textSection = hasTextBox
    ? mergeFragments(
        { panels: [textBox], texts: [], symbols: [], setIcons: [], rules: [] },
        placeFlowedInBox(textBox, flowed),
      )
    : EMPTY_FRAGMENT;

  return { art, fragment: mergeFragments(chrome, typeBar, textSection), rotatedSections: [] };
}

/**
 * Tall side-by-side frame for Sagas (chapters left, art right) and Classes/Cases (art left,
 * levels/solve right), with the type line spanning the bottom above the footer/DFC hint.
 */
function sideBySideFrame(
  input: FrameInput,
  options: Readonly<{ artSide: "left" | "right" }>,
): FrameResult {
  const { card, faces, style, measure } = input;
  const face = faces[0] ?? card.faces[0];
  const { chrome, innerX, innerWidth, bodyTop, bodyBottom } = buildSingleFaceChrome(input, face, {
    includeTokenBadge: false,
  });

  const typeBox: Box = { x: innerX, y: bodyBottom, width: innerWidth, height: LAYOUT.typeHeight };
  const typeBar = buildTypeBar(
    typeBox,
    face?.typeLine ?? "",
    { setIcon: { setCode: card.setCode, rarity: card.rarity } },
    measure,
  );
  const middleBottom = typeBox.y + typeBox.height + LAYOUT.gap;
  const middleHeight = Math.max(0, bodyTop - middleBottom);
  const paragraphs = paragraphsOf(face?.text ?? "");

  if (!style.art) {
    const textBox: Box = { x: innerX, y: middleBottom, width: innerWidth, height: middleHeight };
    const flowed = fitParagraphs(
      paragraphs,
      innerWidth - 2 * LAYOUT.padding,
      middleHeight - 2 * LAYOUT.padding,
      measure,
    );
    const textSection = mergeFragments(
      { panels: [textBox], texts: [], symbols: [], setIcons: [], rules: [] },
      placeFlowedInBox(textBox, flowed),
    );
    return {
      art: null,
      fragment: mergeFragments(chrome, typeBar, textSection),
      rotatedSections: [],
    };
  }

  const textColumnWidth = Math.floor((innerWidth - LAYOUT.gap) * 0.52);
  const artColumnWidth = innerWidth - LAYOUT.gap - textColumnWidth;
  const artOnLeft = options.artSide === "left";
  const art: Box = {
    x: artOnLeft ? innerX : innerX + textColumnWidth + LAYOUT.gap,
    y: middleBottom,
    width: artColumnWidth,
    height: middleHeight,
  };
  const textBox: Box = {
    x: artOnLeft ? innerX + artColumnWidth + LAYOUT.gap : innerX,
    y: middleBottom,
    width: textColumnWidth,
    height: middleHeight,
  };
  const flowed = fitParagraphs(
    paragraphs,
    textBox.width - 2 * LAYOUT.padding,
    textBox.height - 2 * LAYOUT.padding,
    measure,
  );
  const textSection = mergeFragments(
    { panels: [textBox], texts: [], symbols: [], setIcons: [], rules: [] },
    placeFlowedInBox(textBox, flowed),
  );
  return { art, fragment: mergeFragments(chrome, typeBar, textSection), rotatedSections: [] };
}

/** One layout strategy per CardFrameKind: adding a frame kind won't compile until handled here. */
export const FRAME_LAYOUTS = {
  standard: (input) => verticalSingleFaceFrame(input, { kind: "standard" }),
  token: (input) => verticalSingleFaceFrame(input, { kind: "token" }),
  saga: (input) => sideBySideFrame(input, { artSide: "right" }),
  class: (input) => sideBySideFrame(input, { artSide: "left" }),
  adventure: (input) => insetSpellFrame(input, { insetSide: "left" }),
  prepare: (input) => insetSpellFrame(input, { insetSide: "right" }),
  split: (input) =>
    twoHalfFrame(input, { defaultArtHeight: LAYOUT.splitArtHeight, bottomOrientation: "upright" }),
  flip: (input) =>
    twoHalfFrame(input, {
      defaultArtHeight: LAYOUT.flipArtHeight,
      bottomOrientation: "rotated180",
    }),
} satisfies Record<CardFrameKind, FrameLayout>;
