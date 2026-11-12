import React from "react";
import { IsoText, insetRect, type WorldRect } from "../deckTower/iso";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { WEIGHT } from "../../theme/scale";
import { MINI_CARD_HEIGHT, MINI_CARD_WIDTH } from "../../components/miniCardFace";

/**
 * SortBinPrint — what is printed on an empty sort bin's platform top: its rating number,
 * big, inside a dotted outline of where the deck will stand. Drawn FLAT in acp's bin world
 * coordinates (the platform spans x −1 → 5.4, y −1 → 7, SortBins.tsx → `PLATFORM`); the
 * caller maps it onto a top face.
 *
 * Layer: feature UI (`src/features/discover`). Two callers draw the exact same print:
 *   - acp's bins (SortBins.tsx → `NumberPrint`, via `faceTransform` at z 0), under the deck;
 *   - the Deck Tower's Add Cards button, a miniature of acp's Comfortable bin (DeckTowerPlatform →
 *     `sortBin`, through IsoSortPlatform `print`, which scales acp's coordinates down).
 *
 * Docs: docs/SORT_CARDS_REQUIREMENTS.md § 5.3, docs/DECK_TOWER.md § "The sort platform".
 */

/**
 * The deck's footprint — a card lying on the platform, in the mini card's own 92 × 132
 * proportions (its face is the mini card, MiniCardSvg in DeckFace) and centred on the platform (y
 * spans 3 ± d/2). The corner is the mini card's 8px radius at this width (8 × 4.4 / 92).
 */
export const SORT_BIN_DECK_W = 4.4;
const DECK_D = (SORT_BIN_DECK_W * MINI_CARD_HEIGHT) / MINI_CARD_WIDTH;
export const SORT_BIN_DECK: WorldRect = { x: 0, y: 3 - DECK_D / 2, w: SORT_BIN_DECK_W, d: DECK_D, r: (8 * SORT_BIN_DECK_W) / MINI_CARD_WIDTH };

/**
 * Where the empty platform's number sits: the platform's centre (DECK is inset 1 unit on
 * each side of PLATFORM in x, and centred in y), so the first card covers it.
 */
export const SORT_BIN_NUMBER_AT = { x: 2.2, y: 3 };
/**
 * The bin's rating number (1–4, the page prompt's "Rate each card 1–4"), printed big in the
 * middle of the empty platform's top (SortBinPrint) — the whole top is its own now that the
 * sentence moved to the speech bubble (user request 2026-11-09). Type size in world units:
 * a digit ~2.9 units tall on the platform's 6.4 × 8 top.
 */
const BIN_NUMBER_SIZE = 4;
/**
 * Extra weight on the number, world units of same-ink stroke round each glyph (half of it
 * lands outside the outline). 975 Maru SC ships one weight and synthesised bold is the
 * browser's only step up, so a heavier number needs the stroke (user request 2026-11-09).
 */
const NUMBER_EMBOLDEN = 0.18;
/**
 * The dotted outline on the platform's top where the deck will stand (user request
 * 2026-11-09): the first card's own footprint (DECK — the mini card's shape and corner),
 * inset by half the stroke plus NUMBER_BOX_CLEARANCE so the line lies wholly under the
 * card and the first sort covers it completely (flush at half the stroke, the dots'
 * anti-aliased outer edge still peeked out round the card — user report 2026-11-09). Short rounded dashes ("longer dots", user request 2026-11-09 —
 * were round dots): NUMBER_BOX_DASH long plus the round caps (one stroke width more),
 * then NUMBER_BOX_DASH_GAP (less the caps) clear — ~0.4 inked to ~0.3 clear (0.6 / 0.35
 * read "too long"). Thinned 0.2 → 0.12 ("less thick"), the dash and gap retuned so the
 * dashes keep their length.
 * Stroked in the number's grey (PRINT_INK, washed). Before this it was a solid line
 * inset from the platform's edge (2026-11-09, briefly).
 */
const NUMBER_BOX_STROKE = 0.12;
const NUMBER_BOX_DASH = 0.28;
const NUMBER_BOX_DASH_GAP = 0.42;
const NUMBER_BOX_CLEARANCE = 0.15;
/**
 * The outline's own corner radius — rounder than the inset card's (insetRect leaves only
 * ~0.2 of DECK's 0.38 corner), user request 2026-11-09 "more rounded corners". A rounder
 * corner only pulls the line further inside the card, so it stays covered.
 */
const NUMBER_BOX_RADIUS = 0.7;
const NUMBER_BOX: WorldRect = { ...insetRect(SORT_BIN_DECK, NUMBER_BOX_STROKE / 2 + NUMBER_BOX_CLEARANCE), r: NUMBER_BOX_RADIUS };
/**
 * The outline's dash pattern, fitted to the loop: a whole number of dash + gap periods round
 * the rounded rect's perimeter (four straight runs + one full circle of corners), each
 * stretched or squeezed a little from NUMBER_BOX_DASH / NUMBER_BOX_DASH_GAP. With a
 * fractional count the last dash ran into the first where the <rect>'s stroke starts and
 * ends (its top-left, past the corner) — user report 2026-11-09.
 */
const NUMBER_BOX_DASHES = (() => {
    const { w, d, r } = NUMBER_BOX;
    const perimeter = 2 * (w + d) - 8 * r + 2 * Math.PI * r;
    const period = NUMBER_BOX_DASH + NUMBER_BOX_DASH_GAP;
    const fit = perimeter / Math.max(1, Math.round(perimeter / period)) / period;
    return `${NUMBER_BOX_DASH * fit} ${NUMBER_BOX_DASH_GAP * fit}`;
})();
/**
 * The ink of what is printed on a bin — its number — and of the speech bubble's sentence: the framework's secondary-text grey (`textSecondary`,
 * --muted), user request 2026-11-09 "make all the text grey" (was `onSurface`). The mid
 * grey `greyA` was the other candidate but is too light to read on the pastel band colours.
 */
export const SORT_BIN_PRINT_INK = COLORS.textSecondary;

/**
 * The bin's rating number printed flat, big, in 975 Maru SC (the app's rounded face,
 * reached through `FONTS.cjk` — useChineseFont sets it; user request 2026-11-09, was the UI
 * sans). Maru ships one weight, so the bold is browser-synthesised and thickened further by
 * a same-ink stroke (NUMBER_EMBOLDEN), inside a dotted outline of the deck's footprint
 * (NUMBER_BOX). `ink` is the caller's washed SORT_BIN_PRINT_INK.
 */
export const SortBinPrint: React.FC<{ number: number; ink: string }> = ({ number, ink }) => (
    <g className="sort-bin-print">
        <rect
            className="sort-bin-print__box"
            x={NUMBER_BOX.x}
            y={NUMBER_BOX.y}
            width={NUMBER_BOX.w}
            height={NUMBER_BOX.d}
            rx={NUMBER_BOX.r}
            fill="none"
            stroke={ink}
            strokeWidth={NUMBER_BOX_STROKE}
            strokeDasharray={NUMBER_BOX_DASHES}
            strokeLinecap="round"
        />
        {/* IsoText, not dominantBaseline="central": centres the digit's INK on SORT_BIN_NUMBER_AT in
            WebKit too (the numbers sat off the dotted box's centre on iPhone, 2026-11-10). */}
        <IsoText
            className="sort-bin-print__number"
            x={SORT_BIN_NUMBER_AT.x}
            y={SORT_BIN_NUMBER_AT.y}
            textAnchor="middle"
            fontFamily={FONTS.cjk}
            fontSize={BIN_NUMBER_SIZE}
            fontWeight={WEIGHT.bold}
            fill={ink}
            // Heavier than Maru's one weight can go: synthesised bold plus a stroke in the
            // same ink round every glyph (NUMBER_EMBOLDEN, round joins keep it soft).
            stroke={ink}
            strokeWidth={NUMBER_EMBOLDEN}
            strokeLinejoin="round"
        >
            {number}
        </IsoText>
    </g>
);
