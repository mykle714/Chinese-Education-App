import { useCallback, useEffect, useRef, useState } from "react";
import { Box } from "@mui/material";
import { keyframes } from "@mui/system";
import CenterSectionHeading from "./CenterSectionHeading";
import MiniVocabCard from "../../../components/MiniVocabCard";
import { MINI_CARD_WIDTH, MINI_CARD_HEIGHT, MINI_CARD_RADIUS } from "../../../components/miniCardFace";
import {
    buildPool, initialLayout, poolSize, replaceTile,
    type GridPool, type PlacedTile,
} from "./wordGridModel";
import { useWordGridGeometry, WORD_GRID_SIDE_GUTTER as SIDE_GUTTER, type GridRect as Rect } from "./useWordGridGeometry";
import { markFlashcard } from "../../../api/flashcards";
import {
    CORRECT_WASH, INCORRECT_WASH, CARD_FLIP_MS, CARD_FLY_OUT_MS,
} from "../constants";
import type { VocabEntry } from "../../../types";
import { COLORS } from "../../../theme/colors";
import { FONTS } from "../../../theme/fonts";
import { WEIGHT } from "../../../theme/scale";
import { SHADOW } from "../../../theme/shadows";

/**
 * The Reading Center's word swipe grid (docs/READING_WRITING_CENTERS.md § Phase 2).
 *
 * The learner's card words packed into a 6×6 grid of square cells, a word spanning one
 * cell per character. Each tile is a tiny flashcard:
 *
 *   TAP        — the tile grows in place and flips to its dd; ← → arrows appear beside it.
 *   SWIPE      — right = "I could read it" (correct reading mark), left = "I couldn't"
 *                (incorrect). The tile flies off, the mark is written, and the hole it
 *                leaves refills with fresh words from the pool.
 *   TAP AWAY   — anywhere else flips it back. No mark.
 *
 * The layout is drawn fresh on every visit (random, Study Mix band weights on the
 * READING bar). The packing, sampling and refill rules are pure and live in
 * `wordGridModel.ts` (shared with the Writing Center's grid); this file is the gesture +
 * animation layer. Geometry: `useWordGridGeometry`.
 *
 * ── Geometry ──────────────────────────────────────────────────────────────────
 * Tiles are ABSOLUTELY positioned from (row, col, length) against the measured grid
 * width, not laid out by CSS grid: the open tile animates its own left/top/width/height
 * from its cell rectangle to an enlarged one, and the text inside renders at its native
 * size instead of being scaled up blurry by a transform.
 *
 * Layer: feature component (src/features/flashcards/centers). Reads the Center's card
 * library; writes reading marks through `markFlashcard` (surface "reading-center").
 */

/** Room kept free at each side of an open tile for its arrow. */
const ARROW_ROOM = 30;
/** A drag past this share of the grid's width commits the swipe… */
const SWIPE_GRID_FRACTION = 0.18;
/** …but never less than this, so a narrow grid still needs a deliberate drag. */
const SWIPE_MIN_PX = 48;
/** A flick commits early: at least this far… */
const FLICK_MIN_PX = 24;
/** …moving at least this fast (px/ms) when released, in the drag's direction. */
const FLICK_MIN_VELOCITY = 0.5;
/** The swipe-hint triangle, px. */
const ARROW_W = 16;
const ARROW_H = 22;
/** How long a tile takes to grow / shrink. */
const GROW_MS = 200;

const tileArrive = keyframes`
    from { opacity: 0; transform: scale(0.85); }
    to   { opacity: 1; transform: scale(1); }
`;

/** The open tile's state machine. */
type OpenTile = {
    key: string;
    /** Horizontal drag offset in px while the finger is down. */
    dx: number;
    /** Set once a swipe commits: the tile is flying off this way. */
    leaving: "left" | "right" | null;
};

interface ReadingSwipeGridProps {
    cards: readonly VocabEntry[];
    /** True until the library has loaded — the grid waits rather than drawing an empty board. */
    loading: boolean;
}

const ReadingSwipeGrid: React.FC<ReadingSwipeGridProps> = ({ cards, loading }) => {
    // ── The visit's words ───────────────────────────────────────────────────────
    // Built ONCE, from the first non-empty library this page sees: the panel refetches
    // in the background (and on Back restore paints from a cached copy first), and
    // re-deriving on each new `cards` identity would reshuffle the board under the
    // learner's thumb. "Fresh every visit" means fresh every MOUNT.
    const poolRef = useRef<GridPool | null>(null);
    const keySeq = useRef(0);
    const nextKey = useCallback(() => `t${keySeq.current++}`, []);
    const [tiles, setTiles] = useState<PlacedTile[]>([]);
    const [remaining, setRemaining] = useState(0);

    useEffect(() => {
        if (poolRef.current || cards.length === 0) return;
        const pool = buildPool(cards, Date.now(), Math.random, { bar: "reading" });
        poolRef.current = pool;
        const layout = initialLayout(pool, Math.random, nextKey);
        setTiles(layout);
        setRemaining(poolSize(pool) + layout.length);
    }, [cards, nextKey]);

    // ── Geometry ────────────────────────────────────────────────────────────────
    const { gridRef, gridWidth, cell, gridHeight, cellRect } = useWordGridGeometry(tiles.length > 0);
    // Grown around the tile's centre, clamped so it (and its arrows) stay on the grid.
    // An open tile becomes EXACTLY a mini card (92×132, the Cards sheet's thumbnail),
    // because its back face IS one — centred on the cell it grew from, clamped onto the
    // grid with room for the swipe triangles either side.
    const openRect = (t: PlacedTile): Rect => {
        const base = cellRect(t);
        const width = MINI_CARD_WIDTH;
        const height = MINI_CARD_HEIGHT;
        const cx = base.left + base.width / 2;
        const cy = base.top + base.height / 2;
        return {
            left: Math.min(Math.max(cx - width / 2, ARROW_ROOM), gridWidth - ARROW_ROOM - width),
            top: Math.min(Math.max(cy - height / 2, 0), Math.max(gridHeight - height, 0)),
            width,
            height,
        };
    };

    // ── The open tile ───────────────────────────────────────────────────────────
    const [open, setOpen] = useState<OpenTile | null>(null);
    const dragStartX = useRef<number | null>(null);
    const leaveTimer = useRef<number | null>(null);
    useEffect(() => () => { if (leaveTimer.current) window.clearTimeout(leaveTimer.current); }, []);

    const close = () => { if (!open?.leaving) setOpen(null); };

    // Commit a swipe: fly the tile off, then write the mark and refill its cells.
    const commit = (tile: PlacedTile, direction: "left" | "right") => {
        setOpen({ key: tile.key, dx: 0, leaving: direction });
        markFlashcard({ cardId: tile.cardId, isCorrect: direction === "right", type: "reading", surface: "reading-center" })
            .catch((err) => console.error(`[ReadingCenter] reading mark failed → card ${tile.cardId}:`, err));
        leaveTimer.current = window.setTimeout(() => {
            const pool = poolRef.current;
            if (pool) {
                setTiles((prev) => replaceTile(prev, tile, pool, Math.random, nextKey));
                // The swiped word is done for this visit, so the pool + board shrinks by one.
                setRemaining((n) => n - 1);
            }
            setOpen(null);
        }, CARD_FLY_OUT_MS);
    };

    // Dismiss threshold: a fraction of the GRID's width, never the window's. (It used to
    // reuse the flp's `window.innerWidth * CARD_DISMISS_THRESHOLD_VW`, which on a desktop
    // window is ~290px — wider than a drag across the 402px phone frame can comfortably
    // reach — so every swipe snapped back.) A quick FLICK also commits, short of it.
    const threshold = () => Math.max(SWIPE_MIN_PX, gridWidth * SWIPE_GRID_FRACTION);
    // Last pointer sample, for the flick velocity.
    const lastSample = useRef<{ x: number; t: number; vx: number }>({ x: 0, t: 0, vx: 0 });

    const onPointerDown = (e: React.PointerEvent) => {
        if (open?.leaving) return;
        dragStartX.current = e.clientX;
        lastSample.current = { x: e.clientX, t: e.timeStamp, vx: 0 };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: React.PointerEvent) => {
        if (dragStartX.current === null || !open || open.leaving) return;
        const prev = lastSample.current;
        const dt = e.timeStamp - prev.t;
        if (dt > 0) lastSample.current = { x: e.clientX, t: e.timeStamp, vx: (e.clientX - prev.x) / dt };
        setOpen({ ...open, dx: e.clientX - dragStartX.current });
    };
    const onPointerUp = (tile: PlacedTile) => () => {
        if (dragStartX.current === null || !open || open.leaving) return;
        dragStartX.current = null;
        const { vx } = lastSample.current;
        const flicked = Math.abs(open.dx) >= FLICK_MIN_PX && Math.abs(vx) >= FLICK_MIN_VELOCITY && Math.sign(vx) === Math.sign(open.dx);
        if (Math.abs(open.dx) >= threshold() || flicked) commit(tile, open.dx > 0 ? "right" : "left");
        else setOpen({ ...open, dx: 0 });
    };

    if (loading && tiles.length === 0) return null;

    return (
        <>
            <CenterSectionHeading
                className="reading-swipe-grid__heading"
                title="Your words"
                meta={`tap to read · ${remaining} ready`}
            />
            {tiles.length === 0 ? (
                <Box
                    className="reading-swipe-grid__empty"
                    sx={{ margin: `0 ${SIDE_GUTTER}px`, padding: "18px", borderRadius: "14px", border: `1px dashed ${COLORS.border}`, textAlign: "center", fontFamily: FONTS.sans, fontSize: 13, color: COLORS.textSecondary }}
                >
                    Every card is resting for reading. Come back later!
                </Box>
            ) : (
                <Box sx={{ padding: `0 ${SIDE_GUTTER}px` }}>
                    <Box
                        ref={gridRef}
                        className="reading-swipe-grid"
                        sx={{ position: "relative", width: "100%", height: gridHeight }}
                    >
                        {/* Tap-away catcher: covers the frame while a tile is open, under it.
                            `fixed` resolves against NodePage's surface (it carries a
                            transform), which is exactly the phone frame. */}
                        {open && (
                            <Box
                                className="reading-swipe-grid__backdrop"
                                onPointerDown={close}
                                sx={{ position: "fixed", inset: 0, zIndex: 3 }}
                            />
                        )}

                        {cell > 0 && tiles.map((tile) => {
                            const isOpen = open?.key === tile.key;
                            const rect = isOpen ? openRect(tile) : cellRect(tile);
                            const dx = isOpen ? open.dx : 0;
                            const leaving = isOpen ? open.leaving : null;
                            const flyX = leaving === "right" ? gridWidth + 120 : leaving === "left" ? -(gridWidth + 120) : dx;
                            // The wash fades in as the drag approaches the threshold,
                            // capped at the flp's 0.3 (FlashCardSection).
                            const washOpacity = Math.min(Math.abs(dx) / Math.max(threshold(), 1), 1) * 0.3;
                            return (
                                <Box
                                    key={tile.key}
                                    className={`reading-swipe-grid__tile${isOpen ? " reading-swipe-grid__tile--open" : ""}`}
                                    onClick={() => { if (!open) setOpen({ key: tile.key, dx: 0, leaving: null }); }}
                                    onPointerDown={isOpen ? onPointerDown : undefined}
                                    onPointerMove={isOpen ? onPointerMove : undefined}
                                    onPointerUp={isOpen ? onPointerUp(tile) : undefined}
                                    onPointerCancel={isOpen ? onPointerUp(tile) : undefined}
                                    aria-label={isOpen ? `${tile.word}: ${tile.dd}` : `Read ${tile.word}`}
                                    role="button"
                                    sx={{
                                        position: "absolute",
                                        ...rect,
                                        zIndex: isOpen ? 4 : 1,
                                        cursor: "pointer",
                                        perspective: "600px",
                                        // An open tile owns horizontal drags; a resting one
                                        // leaves the page's vertical scroll alone.
                                        touchAction: isOpen ? "none" : "pan-y",
                                        transform: `translateX(${flyX}px) rotate(${(isOpen ? flyX : 0) / 24}deg)`,
                                        transition: [
                                            `left ${GROW_MS}ms ease`, `top ${GROW_MS}ms ease`,
                                            `width ${GROW_MS}ms ease`, `height ${GROW_MS}ms ease`,
                                            // Follow the finger exactly; animate only the snap-back and the fly-off.
                                            dx !== 0 && !leaving ? "transform 0ms" : `transform ${leaving ? CARD_FLY_OUT_MS : GROW_MS}ms ease`,
                                        ].join(", "),
                                    }}
                                >
                                    {/* Arrival (a refilled hole's words fade in). Its own layer,
                                        because a keyframe on the tile itself would fight the
                                        swipe's inline transform — and with fill-mode `both` it
                                        would pin `scale(1)` over it for good. */}
                                    <Box className="reading-swipe-grid__arrive" sx={{ position: "absolute", inset: 0, animation: `${tileArrive} 260ms ease both` }}>
                                    {/* The flipping body: front = the word, back = its dd. */}
                                    <Box
                                        className="reading-swipe-grid__flipper"
                                        sx={{
                                            position: "absolute",
                                            inset: 0,
                                            transformStyle: "preserve-3d",
                                            transform: isOpen ? "rotateY(180deg)" : "rotateY(0deg)",
                                            transition: `transform ${CARD_FLIP_MS}ms linear`,
                                        }}
                                    >
                                        <TileFace className="reading-swipe-grid__face--front" lifted={isOpen} showing={!isOpen}>
                                            <Box component="span" sx={{ fontFamily: FONTS.cjk,
                                                // 28px as designed, shrunk only when the tile's
                                                // width cannot hold the word at that size — an
                                                // open tile is a 92px mini card, narrower than a
                                                // 3+ character word's row of cells.
                                                fontSize: Math.min(28, (rect.width - 12) / tile.length), fontWeight: WEIGHT.bold, lineHeight: 1, letterSpacing: "0.02em", color: COLORS.onSurface, whiteSpace: "nowrap" }}>
                                                {tile.word}
                                            </Box>
                                        </TileFace>
                                        <TileFace className="reading-swipe-grid__face--back" lifted={isOpen} showing={isOpen} back>
                                            {/* The back is the card's own mini preview — the
                                                same thumbnail the Cards sheet shows, minus the
                                                mastery strip (the tile is a question, not a
                                                progress readout) — so a flipped tile reads as
                                                that card turned over. Mounted only while open: 36
                                                hidden mini cards would cost for nothing. */}
                                            {isOpen && <MiniVocabCard entry={tile.entry} showMasteryStrip={false} />}
                                            <Box
                                                className="reading-swipe-grid__wash"
                                                sx={{ position: "absolute", inset: 0, borderRadius: "inherit", pointerEvents: "none", backgroundColor: dx >= 0 ? CORRECT_WASH : INCORRECT_WASH, opacity: washOpacity }}
                                            />
                                        </TileFace>
                                    </Box>
                                    </Box>
                                </Box>
                            );
                        })}

                        {/* The swipe hint: a solid orange triangle at each side of the open
                            tile, pointing the way it can go, with an ink outline so it reads
                            on any page ground and over neighbouring tiles. */}
                        {open && !open.leaving && (() => {
                            const tile = tiles.find((t) => t.key === open.key);
                            if (!tile) return null;
                            const r = openRect(tile);
                            const top = r.top + r.height / 2 - ARROW_H / 2;
                            const gap = (ARROW_ROOM - ARROW_W) / 2;
                            return (
                                <>
                                    <SwipeTriangle direction="left" left={r.left - gap - ARROW_W} top={top} />
                                    <SwipeTriangle direction="right" left={r.left + r.width + gap} top={top} />
                                </>
                            );
                        })()}
                    </Box>
                </Box>
            )}
        </>
    );
};

/** One swipe-hint triangle (an inline SVG so the fill and the outline are exact). */
const SwipeTriangle: React.FC<{ direction: "left" | "right"; left: number; top: number }> = ({ direction, left, top }) => (
    <Box
        component="svg"
        className={`reading-swipe-grid__arrow reading-swipe-grid__arrow--${direction}`}
        viewBox={`0 0 ${ARROW_W} ${ARROW_H}`}
        width={ARROW_W}
        height={ARROW_H}
        aria-hidden
        sx={{ position: "absolute", left, top, zIndex: 4, pointerEvents: "none", overflow: "visible" }}
    >
        <polygon
            points={direction === "left"
                ? `${ARROW_W - 1.5},1.5 ${ARROW_W - 1.5},${ARROW_H - 1.5} 1.5,${ARROW_H / 2}`
                : `1.5,1.5 1.5,${ARROW_H - 1.5} ${ARROW_W - 1.5},${ARROW_H / 2}`}
            // Orange from the palette's MARK tier (the saturated one that still reads at
            // this size), outlined in ink.
            fill={COLORS.orgMk}
            stroke={COLORS.onSurface}
            strokeWidth={1.5}
            strokeLinejoin="round"
        />
    </Box>
);

/**
 * One face of a tile. Both faces stack; the back one starts turned away.
 *
 * `showing` hides the turned-away face at the flip's MIDPOINT (edge-on), on top of
 * `backface-visibility` — mobile WebKit sometimes draws a mirrored backface anyway.
 * Same defence as the flp's CardFaceSide, timed off the same CARD_FLIP_MS with the same
 * linear curve so 90° lands exactly at the delay.
 */
const TileFace: React.FC<{ className: string; lifted: boolean; showing: boolean; back?: boolean; children: React.ReactNode }> = ({ className, lifted, showing, back, children }) => (
    <Box
        className={`reading-swipe-grid__face ${className}`}
        sx={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            // The front is the design's white `.ct` tile. The back is bare: the MiniVocabCard
            // it holds brings its own face, ring and radius, so the face only matches the
            // radius (for the wash) and adds nothing of its own.
            borderRadius: back ? MINI_CARD_RADIUS : "10px",
            backgroundColor: back ? "transparent" : COLORS.white,
            border: back ? "none" : `1px solid ${COLORS.border}`,
            boxShadow: lifted ? SHADOW.float : "none",
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            transform: back ? "rotateY(180deg)" : undefined,
            visibility: showing ? "visible" : "hidden",
            transition: `visibility 0s linear ${CARD_FLIP_MS / 2}ms`,
            overflow: "hidden",
        }}
    >
        {children}
    </Box>
);

export default ReadingSwipeGrid;
