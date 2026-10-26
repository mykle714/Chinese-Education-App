import React, { useEffect, useRef, useState } from "react";
import { Box } from "@mui/material";
import { keyframes } from "@mui/material/styles";
import { ISO } from "./iso";

/**
 * ShootingStars — occasional meteors streaking across the Deck Tower's night sky
 * (docs/DECK_TOWER.md § "Time of day" → "Shooting stars").
 *
 * Layer: page-private component (feature module `src/features/deckTower`). Drawn in
 * SCREEN space inside SpaceBackdrop, over its star field and behind the scene's svg, so
 * the tower and platform pass in front of a meteor rather than under it.
 *
 * How it works:
 *   - While `active` (timeOfDay.ts `shootingStars`: the look is mostly night), a timer
 *     fires a BURST every `BURST_MEAN_MS` ± `BURST_JITTER` (≈ 9–21 s), so the rhythm
 *     never reads as a metronome. The first burst also waits a random interval, so
 *     arriving at night doesn't fire one instantly.
 *   - A burst is 1–3 meteors, `STAGGER_MS` apart. They share one direction (like a
 *     shower from one radiant) so a burst reads as one event, not a scatter; the
 *     direction (down-left / down-right) is re-picked per burst.
 *   - A meteor is a flat streak — a round head and a tapering tail polygon in `ISO.star`,
 *     no gradient or glow (the iso style has none) — that slides along its heading and
 *     fades in and out by one CSS animation; it removes itself on `animationend`.
 *   - Skipped while the tab is hidden, and entirely under `prefers-reduced-motion`.
 *
 * State lives HERE, not in SpaceBackdrop, so a burst re-renders only this small layer —
 * never the backdrop's scroll-driven DOM writes or the scene.
 *
 * Depends on: iso/palette.ts (`ISO.star`). Depended on by: SpaceBackdrop.tsx.
 */

/** Mean gap between bursts, and its ± fraction of jitter (uniform): 15 s ± 40%. */
const BURST_MEAN_MS = 15_000;
const BURST_JITTER = 0.4;
/** Meteors per burst, inclusive. */
const BURST_MIN = 1;
const BURST_MAX = 3;
/** Delay between successive meteors of one burst (uniform range). */
const STAGGER_MS = [180, 650] as const;
/** One meteor's flight. */
const DURATION_MS = [750, 1100] as const;
/** How far the head travels, px. */
const TRAVEL_PX = [150, 260] as const;
/** Degrees below horizontal the meteor falls at. */
const ANGLE_DEG = [18, 38] as const;
/** The tail's length and the head's radius, px. */
const TAIL_PX = [55, 90] as const;
const HEAD_R = 1.4;
/** Spawn region, as fractions of the backdrop: anywhere across, in the upper part. */
const SPAWN_TOP_MAX = 0.5;

/** Slides the meteor along its (pre-rotated) heading, fading in and out. */
const streak = keyframes`
    0%   { transform: rotate(var(--angle)) translateX(0); opacity: 0; }
    12%  { opacity: 1; }
    65%  { opacity: 1; }
    100% { transform: rotate(var(--angle)) translateX(var(--travel)); opacity: 0; }
`;

interface Meteor {
    id: number;
    /** Start position, as a fraction of the backdrop's width / height. */
    x: number;
    y: number;
    /** Heading in degrees (0 = rightward; positive = clockwise, i.e. falling). */
    angle: number;
    travel: number;
    tail: number;
    duration: number;
}

const between = ([lo, hi]: readonly [number, number]) => lo + Math.random() * (hi - lo);

function prefersReducedMotion(): boolean {
    return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

const ShootingStars: React.FC<{ active: boolean }> = ({ active }) => {
    const [meteors, setMeteors] = useState<Meteor[]>([]);
    const nextId = useRef(0);

    useEffect(() => {
        if (!active || prefersReducedMotion()) return;
        // Every pending timer (the next burst and any staggered meteors), cleared together.
        const timers = new Set<number>();
        const later = (fn: () => void, ms: number) => {
            const id = window.setTimeout(() => {
                timers.delete(id);
                fn();
            }, ms);
            timers.add(id);
        };

        const burst = () => {
            if (document.visibilityState === "visible") {
                const count = BURST_MIN + Math.floor(Math.random() * (BURST_MAX - BURST_MIN + 1));
                // One heading per burst: mirrored about the vertical for a leftward fall.
                const leftward = Math.random() < 0.5;
                let at = 0;
                for (let i = 0; i < count; i++) {
                    const fall = between(ANGLE_DEG);
                    const meteor: Meteor = {
                        id: nextId.current++,
                        // A leftward meteor starts further right, so it crosses the screen.
                        x: leftward ? 0.35 + Math.random() * 0.6 : 0.05 + Math.random() * 0.6,
                        y: Math.random() * SPAWN_TOP_MAX,
                        angle: leftward ? 180 - fall : fall,
                        travel: between(TRAVEL_PX),
                        tail: between(TAIL_PX),
                        duration: between(DURATION_MS),
                    };
                    later(() => setMeteors((m) => [...m, meteor]), at);
                    at += between(STAGGER_MS);
                }
            }
            schedule();
        };
        const schedule = () => later(burst, BURST_MEAN_MS * (1 - BURST_JITTER + Math.random() * 2 * BURST_JITTER));

        schedule();
        return () => {
            timers.forEach((id) => window.clearTimeout(id));
            // Leaving night mid-flight drops the meteors rather than letting them finish
            // over a sky that is no longer night.
            setMeteors([]);
        };
    }, [active]);

    const remove = (id: number) => setMeteors((m) => m.filter((x) => x.id !== id));

    return (
        <Box className="deck-tower-page__shooting-stars" sx={{ position: "absolute", inset: 0, overflow: "hidden" }}>
            {meteors.map((m) => (
                // A zero-size anchor at the head, rotated to the heading; the streak is drawn
                // pointing +x with its tail trailing back along -x.
                <Box
                    key={m.id}
                    className="deck-tower-page__shooting-star"
                    onAnimationEnd={() => remove(m.id)}
                    style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%`, ["--angle" as string]: `${m.angle}deg`, ["--travel" as string]: `${m.travel}px`, animationDuration: `${m.duration}ms` }}
                    sx={{ position: "absolute", width: 0, height: 0, opacity: 0, animation: `${streak} linear forwards` }}
                >
                    <svg
                        width={m.tail + HEAD_R}
                        height={HEAD_R * 2}
                        style={{ position: "absolute", left: -m.tail, top: -HEAD_R, overflow: "visible" }}
                    >
                        {/* Tail: a sliver tapering from the head's width to a point. */}
                        <polygon points={`0,${HEAD_R} ${m.tail},0 ${m.tail},${HEAD_R * 2}`} fill={ISO.star} fillOpacity={0.55} />
                        <circle cx={m.tail} cy={HEAD_R} r={HEAD_R} fill={ISO.star} />
                    </svg>
                </Box>
            ))}
        </Box>
    );
};

export default ShootingStars;
