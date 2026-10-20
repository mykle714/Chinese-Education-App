import React, { useState } from "react";
import { ISO } from "./iso";

/**
 * CardSplat — cards bursting up from the bottom of the screen, as if the falling tower
 * hit a floor just below it (docs/DECK_TOWER_TRANSITIONS.md § "The card splat").
 *
 * Layer: page view (feature module `src/features/deckTower`). DeckTowerPage mounts it,
 * keyed per swap, when useDeckSwap's view reports a `splat` (the transition rolled one,
 * deckTransitions.ts → `impactMs`), and drives it with the swap's own clock — it has no
 * timer of its own. Pure function of `elapsedMs` apart from the burst, which is rolled
 * once on mount.
 *
 * The trap door fires it at `clearedMs`, after the last card has dropped out of sight.
 *
 * Drawn in SCREEN space (viewBox px), not world space: the floor it bursts off is off
 * screen, so the cards are flat tumbling silhouettes, spun in the picture plane and
 * flipped by squashing one axis (the back shows card-wall beige). Every card is launched
 * from just below the bottom edge and falls back past it under gravity; the numbers are
 * chosen so the last one is gone within SPLAT_MAX_MS, which fits inside the shortest gap
 * between a trap door's impact and the end of its swap (hold + close + rebound = 1000 ms).
 */

interface CardSplatProps {
    /** ms since the tower hit the floor. */
    elapsedMs: number;
    /** The screen's bottom edge, in viewBox y. */
    floorY: number;
    /** The tower's screen-x span at the moment of impact: the cards burst from across it. */
    minX: number;
    maxX: number;
    /** Screen px per world unit. */
    unit: number;
    /** Cards that were on the fallen tower (read once, at mount): sets how many fly. */
    cards: number;
    /** The fallen deck's head band (read once, at mount). */
    bandColor: string;
    /** World footprint of one card: the flying cards are a fraction of it. */
    cardW: number;
    cardD: number;
}

/** Cartoon gravity for the splatter, world units / s² (a touch heavier than the fall's). */
const SPLAT_GRAVITY = 170;
/** How high a card may fly above the bottom edge, world units. */
const SPLAT_APEX_MIN = 3.5;
const SPLAT_APEX_MAX = 9;
/** Cards leave over this window after impact, most of them early. */
const SPLAT_SPREAD_MS = 220;
/** Every card is below the edge again by this long after impact. */
export const SPLAT_MAX_MS = 950;
/** One flying card per this many cards on the tower, within the min/max. */
const CARDS_PER_FLYER = 20;
const FLYERS_MIN = 5;
const FLYERS_MAX = 14;
/** Flying cards are drawn at this fraction of a card's footprint (they are "further down"). */
const FLYER_SCALE_MIN = 0.32;
const FLYER_SCALE_MAX = 0.48;
/** The printed head band's share of a card's length. */
const BAND_SHARE = 0.2;

interface Flyer {
    delayMs: number;
    x0: number;
    /** World units / s. */
    vx: number;
    vy: number;
    rot0: number;
    /** Degrees / s in the picture plane. */
    spin: number;
    /** Radians / s of end-over-end flip. */
    flipRate: number;
    scale: number;
}

const between = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

function rollBurst(cards: number, minX: number, maxX: number): Flyer[] {
    if (cards <= 0) return [];
    const n = Math.min(FLYERS_MAX, Math.max(FLYERS_MIN, Math.round(cards / CARDS_PER_FLYER)));
    const centre = (minX + maxX) / 2;
    return Array.from({ length: n }, () => {
        const x0 = between(minX, maxX);
        // Mostly outward from the centre, the way a column crumpling into the floor sprays;
        // a few cross over.
        const out = Math.sign(x0 - centre) || 1;
        const dir = Math.random() < 0.2 ? -out : out;
        return {
            delayMs: SPLAT_SPREAD_MS * Math.random() ** 2,
            x0,
            vx: dir * between(6, 28),
            vy: Math.sqrt(2 * SPLAT_GRAVITY * between(SPLAT_APEX_MIN, SPLAT_APEX_MAX)),
            rot0: between(-40, 40),
            spin: (Math.random() < 0.5 ? -1 : 1) * between(300, 900),
            flipRate: between(6, 16),
            scale: between(FLYER_SCALE_MIN, FLYER_SCALE_MAX),
        };
    });
}

const CardSplat: React.FC<CardSplatProps> = ({ elapsedMs, floorY, minX, maxX, unit, cards, bandColor, cardW, cardD }) => {
    // Rolled once on mount; the page passes the FALLEN tower's count and band (from the
    // swap view), not the new deck's.
    const [burst] = useState(() => ({ flyers: rollBurst(cards, minX, maxX), bandColor }));
    if (elapsedMs >= SPLAT_MAX_MS) return null;

    return (
        <g className="deck-tower-card-splat" pointerEvents="none">
            {burst.flyers.map((f, i) => {
                const s = (elapsedMs - f.delayMs) / 1000;
                if (s < 0) return null;
                const w = cardW * f.scale * unit;
                const h = cardD * f.scale * unit;
                const rise = f.vy * s - 0.5 * SPLAT_GRAVITY * s * s;
                // Launched from half a card below the edge, so it emerges rather than pops in.
                const y = floorY + h / 2 - rise * unit;
                if (rise < 0 && y - h > floorY) return null;
                const x = f.x0 + f.vx * s * unit;
                const flip = Math.cos(f.flipRate * s);
                const faceUp = flip >= 0;
                const rx = Math.min(w, h) * 0.08;
                return (
                    <g
                        key={i}
                        className="deck-tower-card-splat__card"
                        transform={`translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${(f.rot0 + f.spin * s).toFixed(1)}) scale(1 ${Math.max(0.04, Math.abs(flip)).toFixed(3)})`}
                    >
                        <rect
                            className="deck-tower-card-splat__stock"
                            x={-w / 2}
                            y={-h / 2}
                            width={w}
                            height={h}
                            rx={rx}
                            fill={faceUp ? ISO.card.top : ISO.card.left}
                            stroke={ISO.cardSeam}
                            strokeWidth={1}
                            vectorEffect="non-scaling-stroke"
                        />
                        {faceUp && (
                            <rect
                                className="deck-tower-card-splat__band"
                                x={-w / 2 + rx}
                                y={-h / 2 + rx}
                                width={w - 2 * rx}
                                height={h * BAND_SHARE}
                                rx={rx / 2}
                                fill={burst.bandColor}
                            />
                        )}
                    </g>
                );
            })}
        </g>
    );
};

export default CardSplat;
