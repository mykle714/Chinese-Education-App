import React, { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
    IsoPlatform,
    IsoScene,
    IsoSolid,
    ISO,
    faceTransform,
    insetRect,
    makeProjector,
    platformTone,
    prism,
    type WorldRect,
} from "../deckTower/iso";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { WEIGHT } from "../../theme/scale";
import type { SortLook } from "./sortTimeOfDay";
import { KEYCAP_POP_TRANSITION } from "../../theme/keycapPress";
import MiniCard from "../../components/MiniCard";
import { MINI_CARD_HEIGHT, MINI_CARD_RING, MINI_CARD_WIDTH } from "../../components/miniCardFace";
import type { DiscoverCard } from "../../types";
import { stripParentheses } from "../../utils/definitionUtils";

/**
 * SortBins — acp's four drop targets, one per utcm band, drawn as iso decks on floating
 * platforms (docs/SORT_CARDS_REQUIREMENTS.md § 5.3 "Bins"; Claude Design "Tower Tier 2 -
 * Time of Day", the "Sort ·" artboards → `sbins` / `sdeck`).
 *
 * Layer: feature UI (`src/features/discover`), drawn with the Deck Tower's iso kit
 * (docs/ISO_ART_FRAMEWORK.md). One IsoScene holds all four bins, laid out as a
 * tetromino on the ISO GRID (BIN_CELLS; +isoX "right" = up-right, +isoY "top" = up-left):
 * an S piece — Target down-right of Unfamiliar, Comfortable up-right of Target, Mastered
 * down-right of Comfortable (user layout 2026-11-09). Each bin is
 *   - a platform in its band's colour floating over the page ground (IsoPlatform
 *     `floating`, its shadow cast on the ground), all four bobbing in sync;
 *   - while EMPTY, the bin's rating number (1–4, which the page's prompt "Rate each card
 *     1–4…" names) printed big in the middle of the platform's top (NumberPrint);
 *   - a deck of cream card stock, one layer per card sorted into it THIS SESSION — the
 *     first sort covers the number, and the deck grows as the learner sorts (Undo takes
 *     a layer back off, uncovering the number again at zero);
 *   - the top card's FACE: the real mini preview card (MiniCard, the dock's own card)
 *     of the last word sorted there, mapped flat onto the top layer (DeckFace). No count
 *     (user request 2026-11-09: "get rid of the count").
 *
 * While a card is held over one bin, that bin grows (ACTIVE_SCALE) and says its sentence
 * in a speech bubble rising from its top (SpeechBubble); a card dropped on it despawns at
 * once and the bin sets a new top card down on its deck (PLACE_DROP_PX).
 *
 * The page hit-tests drops through `hitTesterRef` (SortBinsHitTester): the pointer is
 * mapped back onto the world floor and matched to the nearest platform, so the test
 * follows the iso diamonds rather than their overlapping screen boxes.
 *
 * Each bin sits in a `.sort-bins__bin-slot--<index>` group the page animates for its
 * per-platform entrance; `--sort-bins-units-per-px` (useUnitsPerScreenPx) lets that
 * animation cover a true screen distance inside the scaled SVG.
 *
 * Depends on: deckTower/iso, sortTimeOfDay.ts. Depended on by: AddCardsPage.tsx.
 */

/**
 * The scene's drop hit test, handed to the page through `hitTesterRef`.
 *   - `snapshot()` freezes the scene's screen transform — called at drag START, so the
 *     highlight and the drop test share one geometry and a drag-move reads no layout.
 *   - `binAt(clientX, clientY)` maps the pointer onto the world floor (z 0) and returns the
 *     bin whose platform is nearest, if within HIT_MARGIN; null otherwise.
 *   - `highlight(binId)` marks the bin a held card is over (null = none): it grows
 *     (ACTIVE_SCALE) and says its sentence (SpeechBubble). No bin's colours ever change —
 *     the growth is the whole cue (user request 2026-10-29; the other bin used to
 *     desaturate). The active bin is SortBins' OWN state, set imperatively from the drag
 *     handler, so a held card crossing platforms re-renders only this scene (and only the
 *     two bins whose `active` flipped) — not the whole page. As page state it re-rendered
 *     AddCardsPage on every crossing, which lagged a quick sweep over several platforms.
 * The bob and the active-bin growth are ignored (a few px, well inside the margin).
 */
export interface SortBinsHitTester {
    snapshot: () => void;
    binAt: (clientX: number, clientY: number) => string | null;
    highlight: (binId: string | null) => void;
}

export interface SortBinSpec {
    id: string;
    /** The platform's and deck's colour (the band's ramp SURFACE tier). */
    color: string;
    /** The bin's sentence: said in its speech bubble while a card is held over it, and its accessible name. */
    label: string;
}

interface SortBinsProps {
    /** Exactly four bins, in BIN_CELLS order (Unfamiliar, Target, Comfortable, Mastered). */
    bins: readonly SortBinSpec[];
    /** The cards sorted into each bin this session, by bin id, oldest first. */
    decks: Record<string, readonly DiscoverCard[]>;
    look: SortLook;
    /**
     * Filled with this scene's drop hit test and highlight (`SortBinsHitTester`), which
     * the page calls from the held card's drag handlers.
     */
    hitTesterRef: React.MutableRefObject<SortBinsHitTester | null>;
    className?: string;
}

// ── Geometry (world units) ──────────────────────────────────────────────────────────
/**
 * How much smaller the four S-laid bins are than the artboard's two (`setProj(13, …)`).
 * Applied to the projector's UNIT, so every world-unit size below (slab, deck, type)
 * shrinks with it. 0.7 (raised from 0.66 on 2026-11-09, user request "increase the size
 * of the platforms") with GRID_GAP 1.9 spans ~372 of the 390 box — ~9px each side, so
 * this is about the largest the S piece can go without overflowing a phone's width.
 */
const BIN_SCALE = 0.7;
const UNIT = 13 * BIN_SCALE;
/**
 * The deck's footprint — a card lying on the platform, in the mini card's own 92 × 132
 * proportions (its face is the real MiniCard, DeckFace) and centred on the platform (y
 * spans 3 ± d/2). The corner is the mini card's 8px radius at this width (8 × 4.4 / 92).
 */
const DECK_W = 4.4;
const DECK_D = (DECK_W * MINI_CARD_HEIGHT) / MINI_CARD_WIDTH;
const DECK: WorldRect = { x: 0, y: 3 - DECK_D / 2, w: DECK_W, d: DECK_D, r: (8 * DECK_W) / MINI_CARD_WIDTH };
/** World units per mini-card px on the deck's face (DeckFace's scale). */
const FACE_UNITS_PER_PX = DECK_W / MINI_CARD_WIDTH;
/** The platform, a unit wider than the deck all round. */
const PLATFORM: WorldRect = { x: -1, y: -1, w: 6.4, d: 8, r: 1 };
const PLATFORM_THICKNESS = 1.2;
/** The ground the platforms' shadows fall on, this far below their undersides. */
const GROUND_GAP = 1.6;
/**
 * One card layer's pitch, and its solid height (the rest is the seam between layers).
 * Thickened 2026-11-09 (user request: "increase the thickness of a card"), from 0.2 / 0.15.
 */
const LAYER_PITCH = 0.42;
const LAYER_SOLID = 0.34;
/**
 * The most layers a deck draws. A long session can sort far more than this; past it the
 * deck stops growing. Cut from 20 to 10 with the thicker cards, so a full deck stays
 * about as tall as it was (4.2 vs 4 units). On the iso grid a full deck
 * (~32px at BIN_SCALE) stays clear of the platform behind it: its top maps ~3.3 world
 * units back along the floor diagonal, short of the neighbour across the GRID_GAP.
 * The scene's viewBox (LAYOUT) makes room for it on the farthest bin.
 */
const MAX_LAYERS = 10;
/**
 * Where the empty platform's number sits: the platform's centre (DECK is inset 1 unit on
 * each side of PLATFORM in x, and centred in y), so the first card covers it.
 */
const NUMBER_AT = { x: 2.2, y: 3 };
/**
 * The bin's rating number (1–4, the page prompt's "Rate each card 1–4"), printed big in the
 * middle of the empty platform's top (NumberPrint) — the whole top is its own now that the
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
const NUMBER_BOX: WorldRect = { ...insetRect(DECK, NUMBER_BOX_STROKE / 2 + NUMBER_BOX_CLEARANCE), r: NUMBER_BOX_RADIUS };
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
const PRINT_INK = COLORS.textSecondary;

// ── The speech bubble (viewBox px ≈ screen px: the scene is ~390 wide on a phone) ─────
/**
 * While a card is held over a bin, its sentence pops up in a speech bubble whose tail
 * rises from the bin's top (user request 2026-11-09: "a speech bubble sourced from the
 * hovered platform itself"; the sentences used to be printed on the platforms). Flat
 * white card-stock bubble, no outline (the iso style has none), lowercase grey type.
 */
const BUBBLE_TEXT_PX = 14;
const BUBBLE_LINE_PX = 17;
const BUBBLE_PAD_X = 12;
const BUBBLE_PAD_Y = 9;
/** The widest the bubble's text runs before it wraps. */
const BUBBLE_MAX_TEXT_W = 170;
const BUBBLE_RADIUS = 10;
/**
 * The tail: its base width on the bubble, its length, and the gap left between its tip and
 * the bin's top. Lifted clear of the bin (user requests 2026-11-09: 14 / 14 / 0 → a 56px
 * tail, "too long" → 28 with a 28px gap, gap "a little too big" → 16), so the bubble sits
 * ~44px above the bin — above
 * most of the held card (a mini card is 132 tall, held near its middle), its text
 * readable mid-drag.
 */
const BUBBLE_TAIL_W = 16;
const BUBBLE_TAIL_H = 28;
const BUBBLE_TIP_GAP = 16;
/** The least gap between the bubble and the scene box's sides, so it never leaves the screen. */
const BUBBLE_EDGE = 8;
const BUBBLE_FILL = COLORS.white;
const BUBBLE_POP_MS = 160;
/**
 * The bubble's layer: an SVG covering the page, portalled into the page's STACKING ROOT
 * (`stackingRootOf` — the NodePage's slide wrapper, which usePageSlide keeps transformed)
 * at this z-index. There it paints over the page header and the toolbar keycaps (user
 * request 2026-11-09 — inside the scene it was under both, and a far bin's bubble reaches
 * up into them) but UNDER the held card, DraggableCard's 1000 in the same stacking context
 * (user request 2026-11-09: the bubble must not cover the card). Portalled to <body> it
 * sat above the whole page, card included: the page's transform makes the card's 1000
 * local to the page.
 */
const BUBBLE_LAYER_Z = 999;

/**
 * The nearest ancestor of `el` that starts a stacking context AND is a containing block
 * for an absolutely positioned child (a transform / will-change: transform / filter, or a
 * positioned element with a z-index) — where the bubble layer can sit among the page's own
 * z-indexed layers. Falls back to <body>.
 */
function stackingRootOf(el: Element | null): HTMLElement {
    for (let node = el?.parentElement ?? null; node && node !== document.body; node = node.parentElement) {
        const cs = getComputedStyle(node);
        if (
            cs.transform !== "none" ||
            cs.filter !== "none" ||
            /transform/.test(cs.willChange) ||
            (cs.position !== "static" && cs.zIndex !== "auto")
        ) return node;
    }
    return document.body;
}

const proj = makeProjector(UNIT);

/**
 * The tetromino, in ISO GRID cells (the project's iso convention — docs/NIGHT_MARKET_FEATURE.md
 * § "Coordinate System": +isoX is "right", up-right on screen; +isoY is "top", up-left on
 * screen; −isoY is down-right). One cell per bin, in `bins` order — an S piece (user
 * layout 2026-11-09, flipped from the Z): Target down-right of Unfamiliar (−isoY),
 * Comfortable up-right of Target (+isoX), Mastered down-right of Comfortable (−isoY).
 * On screen the bins zigzag left to right high, low, high, low.
 *
 *     isoY  0   [ U ]
 *     isoY −1   [ T ][ C ]
 *     isoY −2        [ M ]
 *          isoX  0    1
 */
const BIN_CELLS = [
    { isoX: 0, isoY: 0 },
    { isoX: 0, isoY: -1 },
    { isoX: 1, isoY: -1 },
    { isoX: 1, isoY: -2 },
] as const;
/** World units of floor between neighbouring platforms (1.4 → 1.9 on 2026-11-09, "a little" further apart). */
const GRID_GAP = 1.9;
/**
 * A cell's offset in WORLD units. The iso kit's world runs +x down-right and +y
 * down-left (docs/ISO_ART_FRAMEWORK.md), so +isoX (up-right) is world −y and +isoY
 * (up-left) is world −x; one cell is a platform plus the gap on that axis.
 */
const CELL_WORLD = BIN_CELLS.map((c) => ({
    x: -c.isoY * (PLATFORM.w + GRID_GAP),
    y: -c.isoX * (PLATFORM.d + GRID_GAP),
}));
/**
 * Paint order: farthest first (smallest world x + y — the cell highest up the screen), so
 * a nearer bin always paints over the shadow and front edge of the one behind it.
 * Indices into `bins` / BIN_CELLS.
 */
const DRAW_ORDER = CELL_WORLD.map((w, i) => ({ depth: w.x + w.y, i })).sort((a, b) => a.depth - b.depth).map(({ i }) => i);

/** Headroom above the tallest deck for the bob and the active-bin growth, viewBox px. */
const SCENE_TOP_MARGIN = 6;
/**
 * How far the box's bottom edge sits below the nearest platform's front corner, viewBox
 * px: the bins hang past the box's bottom edge (the scene is `overflow: visible`) toward
 * the on-deck cards, as the user placed them 2026-10-29.
 */
const SCENE_BOTTOM_MARGIN = 16;
/** The scene box's width — the 390px artboard. */
const SCENE_WIDTH = 390;

/**
 * The scene layout, derived once from the cells: each bin's screen origin (the group
 * centred horizontally in the 390 box) and the viewBox that holds the whole group, from
 * a full `MAX_LAYERS` deck on the farthest bin down to just past the nearest bin's front
 * corner. Sharp-cornered extents, so it errs a hair generous.
 */
const LAYOUT = (() => {
    const corners = [
        [PLATFORM.x, PLATFORM.y],
        [PLATFORM.x + PLATFORM.w, PLATFORM.y],
        [PLATFORM.x, PLATFORM.y + PLATFORM.d],
        [PLATFORM.x + PLATFORM.w, PLATFORM.y + PLATFORM.d],
    ];
    const deckTopZ = MAX_LAYERS * LAYER_PITCH;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const raw = CELL_WORLD.map((w) => proj.project(w.x, w.y, 0));
    CELL_WORLD.forEach((w) => {
        for (const [cx, cy] of corners) {
            const top = proj.project(w.x + cx, w.y + cy, 0);
            const under = proj.project(w.x + cx, w.y + cy, -PLATFORM_THICKNESS);
            minX = Math.min(minX, top.x);
            maxX = Math.max(maxX, top.x);
            maxY = Math.max(maxY, under.y);
        }
        // The deck's back corner at its full height is the bin's highest point.
        minY = Math.min(minY, proj.project(w.x + DECK.x, w.y + DECK.y, deckTopZ).y, proj.project(w.x + PLATFORM.x, w.y + PLATFORM.y, 0).y);
    });
    const shiftX = SCENE_WIDTH / 2 - (minX + maxX) / 2;
    const top = Math.floor(minY - SCENE_TOP_MARGIN);
    const bottom = Math.ceil(maxY + SCENE_BOTTOM_MARGIN);
    return {
        origins: raw.map((p) => ({ x: p.x + shiftX, y: p.y })),
        viewBox: `0 ${top} ${SCENE_WIDTH} ${bottom - top}`,
        height: bottom - top,
    };
})();

/**
 * The scene's width ÷ height (its viewBox). The page sizes the scene's box to it, so the
 * box's top edge IS the scene's top (the headroom over a full deck on the farthest bin)
 * and the page can lay things out in the space above it — the rating prompt
 * (AddCardsPage → `SortPrompt`).
 */
export const SORT_BINS_ASPECT_RATIO = SCENE_WIDTH / LAYOUT.height;

/**
 * How far off a platform (world units, measured on the floor) a held card still counts
 * as over it — about the gap, so a drop in a gap lands on the nearer neighbour.
 */
const HIT_MARGIN = 2;

/**
 * PLACING a card: when a bin's count goes UP, its new top card (with the count printed on
 * it) is set down onto the deck from PLACE_DROP_PX above — fading in as it comes down,
 * landing, and settling with a small bounce. This is the WHOLE drop animation: the
 * dragged card despawns the instant it is let go (no fall to the bin — removed by user
 * request 2026-10-29). A count going down by ONE (Undo) plays it backwards (`.sort-bins__lifted`). viewBox px (≈ screen px: the scene is ~390 wide on a phone).
 */
const PLACE_DROP_PX = 28;
const PLACE_MS = 320;
/**
 * A beat between letting go of the card and the new top card starting down, so the
 * despawn and the set-down read as two moments rather than one (user request
 * 2026-10-29). The `both` fill holds the keyframes' 0% (invisible, raised) during it.
 */
const PLACE_DELAY_MS = 120;

/**
 * The drop-target cue: the bin a held card is over grows by this much, so it is plain
 * which deck the card will land on. It settles back the moment the card is let go,
 * while the new top card is set down. Scaled about the bin's own box centre; the page's hit-test uses rects
 * snapshotted at drag start, so the growth never feeds back into which bin is hovered.
 * The grow uses the tower plate's overshoot (theme/keycapPress → KEYCAP_POP_TRANSITION;
 * keys themselves now snap, this timing survives only for non-press motion).
 */
const ACTIVE_SCALE = 1.1;

const BIN_CSS = `
@keyframes sort-bins-place {
    0%   { transform: translateY(-${PLACE_DROP_PX}px); opacity: 0; }
    30%  { opacity: 1; }
    70%  { transform: translateY(0); }
    85%  { transform: translateY(-1.5px); }
    100% { transform: translateY(0); }
}
.sort-bins__placed { animation: sort-bins-place ${PLACE_MS}ms cubic-bezier(0.3, 0.6, 0.4, 1) ${PLACE_DELAY_MS}ms both; }
/* Undo: the place animation BACKWARDS — the old top card lifts off and fades out. */
.sort-bins__lifted { animation: sort-bins-place ${PLACE_MS}ms cubic-bezier(0.3, 0.6, 0.4, 1) reverse both; }
@media (prefers-reduced-motion: reduce) { .sort-bins__placed, .sort-bins__lifted { animation: none; } }
.sort-bins__bin {
    transform-box: fill-box;
    transform-origin: 50% 50%;
    transition: transform ${KEYCAP_POP_TRANSITION};
}
.sort-bins__bin--active { transform: scale(${ACTIVE_SCALE}); }
@media (prefers-reduced-motion: reduce) { .sort-bins__bin { transition: none; } }
@keyframes sort-bins-bubble-pop {
    0%   { transform: scale(0.6); opacity: 0; }
    100% { transform: scale(1); opacity: 1; }
}
/* The bubble pops out of its tail's tip (transform-origin set per bubble). */
.sort-bins__bubble {
    transform-box: view-box;
    animation: sort-bins-bubble-pop ${BUBBLE_POP_MS}ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
    pointer-events: none;
}
@media (prefers-reduced-motion: reduce) { .sort-bins__bubble { animation: none; } }
`;

/**
 * Text measurement for the speech bubble (SpeechBubble), in px at type size 1. One shared canvas
 * context; falls back to an average-glyph estimate where canvas is unavailable (tests).
 */
let measureCtx: CanvasRenderingContext2D | null | undefined;
function measureCtxFor(): CanvasRenderingContext2D | null {
    if (measureCtx === undefined) {
        measureCtx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
    }
    // Measured at 100px and scaled back to a 1-unit size, for sub-pixel precision.
    if (measureCtx) measureCtx.font = `${WEIGHT.semibold} 100px ${FONTS.sans}`;
    return measureCtx;
}
function measureWidth(text: string): number {
    const ctx = measureCtxFor();
    return ctx ? ctx.measureText(text).width / 100 : text.length * 0.62;
}
/** Greedy word wrap of `words` at type size `size` into lines no wider than `maxWidth`. */
function wrapWords(words: string[], size: number, maxWidth: number): string[] | null {
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
        // A single word wider than the box can't be wrapped: this size fails.
        if (measureWidth(word) * size > maxWidth) return null;
        const candidate = line ? `${line} ${word}` : word;
        if (measureWidth(candidate) * size <= maxWidth) {
            line = candidate;
        } else {
            lines.push(line);
            line = word;
        }
    }
    if (line) lines.push(line);
    return lines;
}

/** A bin's speech bubble, laid out in scene (viewBox) px. */
interface BubbleLayout {
    x: number;
    y: number;
    w: number;
    h: number;
    lines: string[];
    /** The tail: a triangle from the bubble's bottom edge down to `tip`. */
    tail: string;
    tip: { x: number; y: number };
}

/**
 * Lays `sentence` out as a speech bubble whose tail ends BUBBLE_TIP_GAP above `source` (the
 * bin's top, scene px):
 * lowercase, word-wrapped to BUBBLE_MAX_TEXT_W, the bubble centred over the tip but slid
 * inward to stay BUBBLE_EDGE inside the scene's width, the tail's base slid along with it
 * (kept clear of the rounded corners) so it still points at the tip.
 */
function layoutBubble(sentence: string, source: { x: number; y: number }): BubbleLayout {
    const tip = { x: source.x, y: source.y - BUBBLE_TIP_GAP };
    const words = sentence.toLowerCase().split(/\s+/).filter(Boolean);
    const lines = wrapWords(words, BUBBLE_TEXT_PX, BUBBLE_MAX_TEXT_W) ?? words;
    const textW = Math.max(...lines.map((l) => measureWidth(l) * BUBBLE_TEXT_PX), 0);
    const w = Math.ceil(textW) + 2 * BUBBLE_PAD_X;
    const h = lines.length * BUBBLE_LINE_PX + 2 * BUBBLE_PAD_Y;
    const x = Math.min(Math.max(tip.x - w / 2, BUBBLE_EDGE), SCENE_WIDTH - BUBBLE_EDGE - w);
    const bottom = tip.y - BUBBLE_TAIL_H;
    const half = BUBBLE_TAIL_W / 2;
    const baseX = Math.min(Math.max(tip.x, x + BUBBLE_RADIUS + half), x + w - BUBBLE_RADIUS - half);
    // The base dips 1px into the body so no hairline shows between the two shapes.
    const tail = `M ${baseX - half} ${bottom - 1} L ${tip.x} ${tip.y} L ${baseX + half} ${bottom - 1} Z`;
    return { x, y: bottom - h, w, h, lines, tail, tip };
}

/**
 * Where a bin's bubble tail ends, relative to the bin's origin: the back corner of its top
 * — the deck's top card when it has one (its back corner sits higher than the platform's),
 * else the bare platform's — so the bubble rises off the back edge without covering it.
 */
function bubbleTipFor(count: number): { x: number; y: number } {
    const shown = Math.min(count, MAX_LAYERS);
    const platformBack = proj.project(PLATFORM.x, PLATFORM.y, 0);
    if (shown === 0) return platformBack;
    const deckBack = proj.project(DECK.x, DECK.y, shown * LAYER_PITCH);
    return deckBack.y < platformBack.y ? deckBack : platformBack;
}

/** The speech bubble: the white body and tail, then the sentence's lines, centred. */
const SpeechBubble: React.FC<{ layout: BubbleLayout }> = ({ layout }) => (
    <g
        className="sort-bins__bubble"
        aria-hidden
        style={{ transformOrigin: `${layout.tip.x}px ${layout.tip.y}px` }}
    >
        <rect className="sort-bins__bubble-body" x={layout.x} y={layout.y} width={layout.w} height={layout.h} rx={BUBBLE_RADIUS} fill={BUBBLE_FILL} />
        <path className="sort-bins__bubble-tail" d={layout.tail} fill={BUBBLE_FILL} />
        <text
            className="sort-bins__bubble-text"
            textAnchor="middle"
            dominantBaseline="central"
            fontFamily={FONTS.sans}
            fontSize={BUBBLE_TEXT_PX}
            fontWeight={WEIGHT.semibold}
            fill={PRINT_INK}
        >
            {layout.lines.map((line, i) => (
                <tspan key={i} x={layout.x + layout.w / 2} y={layout.y + BUBBLE_PAD_Y + (i + 0.5) * BUBBLE_LINE_PX}>
                    {line}
                </tspan>
            ))}
        </text>
    </g>
);

/**
 * A counter that ticks once the page's web fonts have loaded, so a bubble measured
 * against a fallback font on first paint is re-laid with the real one.
 */
function useFontsLoadedEpoch(): number {
    const [epoch, setEpoch] = useState(0);
    useEffect(() => {
        let alive = true;
        document.fonts?.ready.then(() => { if (alive) setEpoch((e) => e + 1); }).catch(() => {});
        return () => { alive = false; };
    }, []);
    return epoch;
}
/**
 * The rim light's white for the deck's TOP layer (IsoSolid → `roundedEdge`,
 * docs/ISO_ART_FRAMEWORK.md § "The rounded edge"). The acp's scene is lit by its `SortLook`,
 * not an iso wash, so this is the unwashed palette's. The layers under the top get no edge:
 * each sits under the next, and a fillet there would read as a doubled seam.
 */
const TOP_EDGE_LIGHT = ISO.edgeLight;
/** A bin with no deck yet (a stable empty list, so the bin's memo holds). */
const NO_CARDS: readonly DiscoverCard[] = [];

interface SortBinProps {
    spec: SortBinSpec;
    /** The bin's rating number, 1–4 (its place in `bins` + 1), printed on its empty top. */
    number: number;
    /** The cards sorted into this bin this session, oldest first; the last is the top card. */
    cards: readonly DiscoverCard[];
    active: boolean;
    look: SortLook;
}

/** True when the device asks for reduced motion (the place animation is then off). */
function prefersReducedMotion(): boolean {
    return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/**
 * The deck's top FACE: the real mini preview card (MiniCard — the dock's own card, the
 * same word, pinyin, icon and gloss the learner just dragged) lying flat on the top layer
 * at height `z`. An HTML card in a <foreignObject>, mapped onto the face by
 * `faceTransform` composed with the card px → world scale, so it lies on the deck like a
 * print (user request 2026-11-09: "fully render the minipreview card in iso").
 * The tile's own elevation and pop-in are dropped — the iso layer under it is its
 * thickness — and only its hairline ring is kept.
 * ⚠️ WebKit has known bugs painting positioned HTML inside a transformed foreignObject;
 * check it on iOS.
 */
const DeckFace: React.FC<{ card: DiscoverCard; z: number }> = ({ card, z }) => (
    <g className="sort-bins__face" transform={`${faceTransform(proj, z)} translate(${DECK.x} ${DECK.y}) scale(${FACE_UNITS_PER_PX})`}>
        <foreignObject className="sort-bins__face-object" x={0} y={0} width={MINI_CARD_WIDTH} height={MINI_CARD_HEIGHT}>
            <MiniCard
                className="sort-bins__face-card"
                language={card.language}
                entryKey={card.entryKey}
                pronunciation={card.pronunciation}
                definition={stripParentheses(card.definition ?? "")}
                iconId={card.iconId}
                background={COLORS.cardFace}
                sx={{ boxShadow: MINI_CARD_RING, animation: "none", pointerEvents: "none" }}
            />
        </foreignObject>
    </g>
);

/**
 * The bin's rating number printed flat in the middle of its platform's top (z 0), big,
 * in 975 Maru SC (the app's rounded face, reached through `FONTS.cjk` — useChineseFont
 * sets it; user request 2026-11-09, was the UI sans). Maru ships one weight, so the bold
 * is browser-synthesised and thickened further by a same-ink stroke (NUMBER_EMBOLDEN),
 * inside a dotted outline of the deck's footprint (NUMBER_BOX). The deck's first card
 * covers both completely.
 */
const NumberPrint: React.FC<{ number: number; ink: string }> = ({ number, ink }) => (
    <g className="sort-bins__number" transform={faceTransform(proj, 0, NUMBER_AT)}>
        <rect
            className="sort-bins__number-box"
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
        <text
            className="sort-bins__number-text"
            x={NUMBER_AT.x}
            y={NUMBER_AT.y}
            textAnchor="middle"
            dominantBaseline="central"
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
        </text>
    </g>
);

/**
 * Card stock (palette `ISO.card`): the top card's cream face and beige walls. A layer
 * UNDER the top shows only its walls and the sliver of its top in the seam above it, so
 * its top takes the stock's seam tone (`ISO.cardSeam`) and the seams read as lines.
 */
const TOP_CARD_MATERIAL = ISO.card;
const UNDER_CARD_MATERIAL = { ...ISO.card, top: ISO.cardSeam };

/** The prism of deck layer `k` (0 = the bottom card). */
const layerGeometry = (k: number) => prism(proj, DECK, k * LAYER_PITCH, k * LAYER_PITCH + LAYER_SOLID);
/** The world z of the face of a deck whose top is layer `layersShown − 1`. */
const faceZ = (layersShown: number) => (layersShown - 1) * LAYER_PITCH + LAYER_SOLID;

/**
 * One deck's top card: its card-stock slab with the rim light, and its face — the real
 * mini card of `card` (DeckFace). `layersShown` is the deck's height in layers (≥ 1).
 */
const TopCard: React.FC<{ card: DiscoverCard | undefined; layersShown: number }> = ({ card, layersShown }) => (
    <>
        <IsoSolid className="sort-bins__layer" geometry={layerGeometry(layersShown - 1)} material={TOP_CARD_MATERIAL} roundedEdge={TOP_EDGE_LIGHT} />
        {card && <DeckFace card={card} z={faceZ(layersShown)} />}
    </>
);

// Memoized: a highlight change re-renders only the bins whose `active` flipped.
const SortBin = memo(function SortBin({ spec, number, cards, active, look }: SortBinProps) {
    const count = cards.length;
    const shown = Math.min(count, MAX_LAYERS);
    // The platform takes the band colour through the tower's wash (SortLook.wash): the
    // same colour, by day and night, as this band's quadrant of the Deck Tower's Add Cards
    // button (IsoSortPlatform → `quadrantColors`, DeckTowerPlatform `wash(CATEGORY_COLORS…)`).
    const wash = look.wash;
    const tone = useMemo(() => platformTone(wash(spec.color)), [spec.color, wash]);
    const printInk = wash(PRINT_INK);
    const underLayers = useMemo(() => Array.from({ length: MAX_LAYERS }, (_, k) => layerGeometry(k)), []);

    // Each RISE in the count re-keys the top card's group, remounting it so its place
    // animation plays (state from the previous render, React's "adjust state while
    // rendering" pattern — no effect, no extra paint of the un-animated card).
    // `placingFrom` is the count BEFORE the rise, held until that animation ends: while
    // the new card is on its way down, the deck under it still shows its old top card
    // (its face too — `cards` still holds it), which the new card then covers.
    const [prevCards, setPrevCards] = useState(cards);
    const [placeKey, setPlaceKey] = useState(0);
    const [placingFrom, setPlacingFrom] = useState<number | null>(null);
    // The mirror for Undo taking ONE card back: `lifted` is the card taken off (gone from
    // `cards` by now, so kept here) and the deck height it sat at; it plays the place
    // animation backwards over the deck as it now stands — whose new top card, the one
    // under it, shows its own face — keyed by `liftKey` so back-to-back undos restart it.
    // Any other fall (several at once) just redraws.
    const [lifted, setLifted] = useState<{ card: DiscoverCard; from: number } | null>(null);
    const [liftKey, setLiftKey] = useState(0);
    if (cards !== prevCards) {
        const prevCount = prevCards.length;
        setPrevCards(cards);
        // No animation runs under reduced motion, so nothing would end either hold.
        const animate = !prefersReducedMotion();
        if (count > prevCount) {
            setPlaceKey((k) => k + 1);
            setPlacingFrom(animate ? prevCount : null);
            setLifted(null);
        } else if (count < prevCount) {
            // Undo mid-placement: drop the placement hold and lift the card off instead.
            setPlacingFrom(null);
            const oneBack = animate && count === prevCount - 1;
            if (oneBack) setLiftKey((k) => k + 1);
            setLifted(oneBack ? { card: prevCards[prevCount - 1], from: prevCount } : null);
        }
    }
    const handlePlaceEnd = (e: React.AnimationEvent<SVGGElement>) => {
        if (e.target === e.currentTarget) setPlacingFrom(null);
    };
    const handleLiftEnd = (e: React.AnimationEvent<SVGGElement>) => {
        if (e.target === e.currentTarget) setLifted(null);
    };
    // The card being lifted off: the old top, at the old height.
    const liftedShown = lifted == null ? 0 : Math.min(lifted.from, MAX_LAYERS);

    // The old top card, still shown under the falling one. At the MAX_LAYERS cap the deck
    // doesn't grow, so the old top sits exactly where the new one lands.
    const oldShown = placingFrom == null ? null : Math.min(placingFrom, MAX_LAYERS);
    const underCount = oldShown == null ? shown - 1 : Math.min(oldShown, shown) - 1;

    const className = ["sort-bins__bin", active && "sort-bins__bin--active"].filter(Boolean).join(" ");
    return (
        <g
            className={className}
            role="img"
            aria-label={`${number}. ${spec.label}: ${count}`}
        >
            <IsoPlatform
                rect={PLATFORM}
                thickness={PLATFORM_THICKNESS}
                ground={{ z: -PLATFORM_THICKNESS - GROUND_GAP, color: look.ground }}
                tone={tone}
                floating
            >
                {/* The bare platform's number, under the deck: the first card covers it. */}
                <NumberPrint number={number} ink={printInk} />
                {underLayers.slice(0, Math.max(underCount, 0)).map((geometry, k) => (
                    <IsoSolid key={k} className="sort-bins__layer" geometry={geometry} material={UNDER_CARD_MATERIAL} />
                ))}
                {/* While a card is being placed: the deck as it was, old top face and all. */}
                {oldShown != null && oldShown > 0 && (
                    <g className="sort-bins__old-top">
                        <TopCard card={cards[(placingFrom ?? 0) - 1]} layersShown={oldShown} />
                    </g>
                )}
                {/* The top card and its face, set down together (PLACE_DROP_PX). */}
                <g
                    key={placeKey}
                    className={placeKey > 0 ? "sort-bins__top sort-bins__placed" : "sort-bins__top"}
                    onAnimationEnd={handlePlaceEnd}
                >
                    {shown > 0 && <TopCard card={cards[count - 1]} layersShown={shown} />}
                </g>
                {/* Undo: the old top card lifting off the deck as it now stands. */}
                {lifted && liftedShown > 0 && (
                    <g key={`lift-${liftKey}`} className="sort-bins__lifted" onAnimationEnd={handleLiftEnd}>
                        <TopCard card={lifted.card} layersShown={liftedShown} />
                    </g>
                )}
            </IsoPlatform>
        </g>
    );
});

/**
 * Publishes the scene's scale as the CSS custom property `--sort-bins-units-per-px` on
 * `el`: how many SVG user units one SCREEN px is. Inside the SVG a CSS `px` is a user
 * unit, so a transform that must cover a screen distance (the page's per-bin entrance
 * slides one full screen width, `100vw`, like a card) multiplies by this. Set before
 * first paint and kept current as the scene resizes.
 */
function useUnitsPerScreenPx(ref: React.RefObject<SVGGElement | null>) {
    useLayoutEffect(() => {
        const el = ref.current;
        const svg = el?.ownerSVGElement;
        if (!el || !svg) return;
        const publish = () => {
            // getScreenCTM().a = screen px per user unit (no rotation or skew here).
            const scale = el.getScreenCTM()?.a;
            if (scale && scale > 0) el.style.setProperty("--sort-bins-units-per-px", String(1 / scale));
        };
        publish();
        const observer = new ResizeObserver(publish);
        observer.observe(svg);
        return () => observer.disconnect();
    }, [ref]);
}

/** Distance (world units) from a floor point to a world rect; 0 inside it. */
function distanceToRect(x: number, y: number, r: WorldRect): number {
    const dx = Math.max(r.x - x, 0, x - (r.x + r.w));
    const dy = Math.max(r.y - y, 0, y - (r.y + r.d));
    return Math.hypot(dx, dy);
}

const SortBins: React.FC<SortBinsProps> = ({ bins, decks, look, hitTesterRef, className }) => {
    const sceneRef = useRef<SVGGElement>(null);
    // The bin a held card is over (SortBinsHitTester → `highlight`). Local state, not a
    // prop, so a crossing re-renders this scene only.
    const [activeBinId, setActiveBinId] = useState<string | null>(null);
    useUnitsPerScreenPx(sceneRef);
    const fontEpoch = useFontsLoadedEpoch();
    // The active bin's speech bubble: its sentence, its tail on the bin's top (which rises
    // with its deck). Re-laid once web fonts load (fontEpoch).
    const activeIndex = bins.findIndex((b) => b.id === activeBinId);
    const activeSpec = activeIndex >= 0 ? bins[activeIndex] : null;
    const activeCount = activeSpec ? decks[activeSpec.id]?.length ?? 0 : 0;
    const bubble = useMemo(() => {
        const origin = LAYOUT.origins[activeIndex];
        if (!activeSpec || !origin) return null;
        const tip = bubbleTipFor(activeCount);
        return layoutBubble(activeSpec.label, { x: origin.x + tip.x, y: origin.y + tip.y });
        // eslint-disable-next-line react-hooks/exhaustive-deps -- fontEpoch re-measures with the loaded font
    }, [activeSpec, activeIndex, activeCount, fontEpoch]);
    // Where the bubble layer is portalled (BUBBLE_LAYER_Z), and the scene's user space →
    // the layer's user space, both read whenever a bubble appears or changes — so the
    // portalled bubble lands exactly where it would inside the scene. The host is looked
    // up then, NOT on mount: during the page's entrance the bins area itself carries a
    // transform (CHROME_ENTRANCE_SX) and would be mistaken for the stacking root. A new
    // host re-runs this effect once its layer has mounted. The map is composed from both
    // screen CTMs, so the host's own transform cancels out. Layout effects re-render
    // before paint, so the bubble never flashes misplaced.
    const [layerHost, setLayerHost] = useState<HTMLElement | null>(null);
    const layerRef = useRef<SVGSVGElement>(null);
    const [sceneToLayer, setSceneToLayer] = useState<string | null>(null);
    useLayoutEffect(() => {
        if (!bubble) return;
        const host = stackingRootOf(sceneRef.current?.ownerSVGElement ?? null);
        if (host !== layerHost) return setLayerHost(host);
        const scene = sceneRef.current?.getScreenCTM();
        const layer = layerRef.current?.getScreenCTM();
        if (!scene || !layer) return setSceneToLayer(null);
        const m = layer.inverse().multiply(scene);
        setSceneToLayer(`matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`);
    }, [bubble, layerHost]);

    // The drop hit test (SortBinsHitTester). `bins` is read through a ref so the tester
    // object stays stable for the page.
    const binsRef = useRef(bins);
    binsRef.current = bins;
    useLayoutEffect(() => {
        let screenToScene: DOMMatrix | null = null;
        hitTesterRef.current = {
            snapshot: () => {
                screenToScene = sceneRef.current?.getScreenCTM()?.inverse() ?? null;
            },
            binAt: (clientX, clientY) => {
                if (!screenToScene) return null;
                const p = new DOMPoint(clientX, clientY).matrixTransform(screenToScene);
                let best: string | null = null;
                let bestDist = HIT_MARGIN;
                binsRef.current.forEach((spec, i) => {
                    const origin = LAYOUT.origins[i];
                    if (!origin) return;
                    // Invert the floor projection (z 0): screen x = (x − y)·u, y = (x + y)·u·slope.
                    const a = (p.x - origin.x) / UNIT;
                    const b = (p.y - origin.y) / (proj.project(1, 1, 0).y / 2);
                    const dist = distanceToRect((a + b) / 2, (b - a) / 2, PLATFORM);
                    if (dist <= bestDist) {
                        bestDist = dist;
                        best = spec.id;
                    }
                });
                return best;
            },
            // A stable setter; React bails out when the bin is unchanged, so the drag
            // handler can call it on every move.
            highlight: setActiveBinId,
        };
        return () => { hitTesterRef.current = null; };
    }, [hitTesterRef]);
    return (
        // Pinned to the BOTTOM of its box ("xMidYMax"), so the platforms sit just above the
        // on-deck cards however tall the screen; the spare height goes above, under the toolbar.
        <IsoScene proj={proj} viewBox={LAYOUT.viewBox} preserveAspectRatio="xMidYMax meet" className={className} style={{ width: "100%", height: "100%", overflow: "visible" }}>
            <style>{BIN_CSS}</style>
            <g ref={sceneRef} className="sort-bins__scene">
                {/* Drawn farthest first (DRAW_ORDER); the slot class keeps the bin's
                    `bins` index, which the page's entrance stagger keys on. */}
                {DRAW_ORDER.filter((i) => i < bins.length).map((i) => {
                    const spec = bins[i];
                    const origin = LAYOUT.origins[i];
                    return (
                        <g key={spec.id} transform={`translate(${origin.x.toFixed(2)} ${origin.y.toFixed(2)})`}>
                            {/* The entrance hook: the page animates this group per bin
                                (`.sort-bins__bin-slot--<index>`). Its own element because a CSS
                                transform on the outer <g> would replace its `transform`
                                attribute, and the bin's <g> below owns the active-scale
                                transform. */}
                            <g className={`sort-bins__bin-slot sort-bins__bin-slot--${i}`}>
                                <SortBin
                                    spec={spec}
                                    number={i + 1}
                                    cards={decks[spec.id] ?? NO_CARDS}
                                    active={activeBinId === spec.id}
                                    look={look}
                                />
                            </g>
                        </g>
                    );
                })}
            </g>
            {/* The held card's target says its sentence, over the page's header and
                toolbar but under the held card (BUBBLE_LAYER_Z). Keyed by bin, so moving
                to another bin pops a fresh one. */}
            {layerHost && createPortal(
                <svg
                    ref={layerRef}
                    className="sort-bins__bubble-layer"
                    aria-hidden
                    style={{ position: layerHost === document.body ? "fixed" : "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none", zIndex: BUBBLE_LAYER_Z }}
                >
                    {bubble && activeSpec && sceneToLayer && (
                        <g transform={sceneToLayer}>
                            <SpeechBubble key={activeSpec.id} layout={bubble} />
                        </g>
                    )}
                </svg>,
                layerHost,
            )}
        </IsoScene>
    );
};

export default memo(SortBins);
