import React, { useLayoutEffect, useMemo, useRef } from "react";
import { Box } from "@mui/material";
import { RAMP } from "../theme/colors";
import { prefersReducedMotion } from "../utils/pageTransition";

/**
 * ConfettiBurst — a one-shot celebratory confetti pop: a fan of small paper pieces flung
 * upward from a point, tumbling, falling under gravity and fading out.
 *
 * Layer: shared presentational component (src/components). Purely decorative —
 * `pointerEvents: "none"` and `aria-hidden`, so it can never swallow a tap or say
 * anything to a screen reader. Plays ONCE on mount and then sits invisible (every piece
 * parks at opacity 0 via `fill: "forwards"`); to replay it, re-mount it with a new `key`.
 * Under `prefers-reduced-motion` it renders nothing.
 *
 * Fills its nearest positioned ancestor (`position: absolute; inset: 0`) and bursts from
 * `origin` (fractions of that box). Pieces are not clipped by the component itself, so
 * they may spill past the box unless an ancestor has `overflow: hidden`.
 *
 * Colours: the mastery-neutral `mid` tier of the RAMP hues (theme/colors.ts), so the
 * confetti stays inside the colour framework.
 *
 * Used by:
 *   - src/features/flashcards/FlashcardsLearnPage/ReadyOutCardLayer.tsx ("Done for the day!")
 *   - src/games/match-speed/MatchSpeedBoard.tsx ("Board Cleared!")
 * Docs: docs/DECK_TOWER.md § "Running out of ready cards";
 *       docs/MATCH_SPEED_GAME.md § Board cleared celebration.
 */

const PIECE_COLORS = [
    RAMP.red.mid,
    RAMP.org.mid,
    RAMP.yel.mid,
    RAMP.grn.mid,
    RAMP.tea.mid,
    RAMP.blu.mid,
    RAMP.pur.mid,
] as const;

/** Physics, in px and seconds. Tuned so the arc peaks ~150–250px above the origin. */
const GRAVITY = 1100;
/** Horizontal air drag (exponential decay rate): pieces fan out fast, then drift. */
const DRAG = 1.8;
/** Sampled keyframes per piece — enough for the parabola to read smooth under linear easing. */
const STEPS = 14;

interface Piece {
    color: string;
    width: number;
    height: number;
    round: boolean;
    /** Initial velocity, px/s (vy negative = up). */
    vx: number;
    vy: number;
    /** Total tumble, degrees. */
    spin: number;
    /** Per-piece start delay, ms — a ragged burst reads more like paper than a ring. */
    delay: number;
}

function makePieces(count: number): Piece[] {
    return Array.from({ length: count }, (_, i) => {
        // An upward cone ±65° either side of straight up.
        const angle = (-90 + (Math.random() * 130 - 65)) * (Math.PI / 180);
        const speed = 420 + Math.random() * 420;
        const round = Math.random() < 0.25;
        const size = 5 + Math.random() * 4;
        return {
            color: PIECE_COLORS[i % PIECE_COLORS.length],
            width: size,
            height: round ? size : size * 1.7,
            round,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            spin: (Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 540),
            delay: Math.random() * 90,
        };
    });
}

/** The piece's flight as WAAPI keyframes: drag-damped x, ballistic y, tumble, late fade. */
function flightKeyframes(p: Piece, durationS: number): Keyframe[] {
    return Array.from({ length: STEPS + 1 }, (_, s) => {
        const f = s / STEPS;
        const t = f * durationS;
        const x = (p.vx * (1 - Math.exp(-DRAG * t))) / DRAG;
        const y = p.vy * t + 0.5 * GRAVITY * t * t;
        // Full opacity for the first 60%, then fade to nothing.
        const opacity = f < 0.6 ? 1 : Math.max(0, 1 - (f - 0.6) / 0.4);
        // rotateX adds a paper-flutter flip on top of the in-plane spin.
        return {
            offset: f,
            opacity,
            transform: `translate(-50%, -50%) translate(${x}px, ${y}px) rotate(${p.spin * f}deg) rotateX(${p.spin * 1.6 * f}deg)`,
        };
    });
}

const ConfettiBurst: React.FC<{
    /** Number of pieces. */
    count?: number;
    /** Flight time, ms. */
    durationMs?: number;
    /** Burst point as fractions of the parent box. Default: the centre. */
    origin?: { x: number; y: number };
    /** Stacking order within the parent. */
    zIndex?: number;
    className?: string;
}> = ({ count = 48, durationMs = 1700, origin = { x: 0.5, y: 0.5 }, zIndex = 4, className }) => {
    const reduced = useMemo(prefersReducedMotion, []);
    // Generated once per mount: a re-render must not reshuffle a burst mid-flight.
    const pieces = useMemo(() => (reduced ? [] : makePieces(count)), [count, reduced]);
    const pieceRefs = useRef<(HTMLDivElement | null)[]>([]);

    useLayoutEffect(() => {
        const animations: Animation[] = [];
        pieces.forEach((p, i) => {
            const el = pieceRefs.current[i];
            if (!el || typeof el.animate !== "function") return;
            animations.push(
                el.animate(flightKeyframes(p, durationMs / 1000), {
                    duration: durationMs,
                    delay: p.delay,
                    easing: "linear",
                    // `both`: hidden during its delay, parked invisible after landing.
                    fill: "both",
                }),
            );
        });
        return () => animations.forEach((a) => a.cancel());
    }, [pieces, durationMs]);

    if (reduced) return null;
    return (
        <Box
            className={`confetti-burst${className ? ` ${className}` : ""}`}
            aria-hidden
            sx={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex, perspective: "600px" }}
        >
            {pieces.map((p, i) => (
                <Box
                    key={i}
                    ref={(el: HTMLDivElement | null) => { pieceRefs.current[i] = el; }}
                    className="confetti-burst__piece"
                    sx={{
                        position: "absolute",
                        left: `${origin.x * 100}%`,
                        top: `${origin.y * 100}%`,
                        width: p.width,
                        height: p.height,
                        borderRadius: p.round ? "50%" : "1px",
                        backgroundColor: p.color,
                        // Invisible until its animation's first frame takes over.
                        opacity: 0,
                        willChange: "transform, opacity",
                    }}
                />
            ))}
        </Box>
    );
};

export default ConfettiBurst;
