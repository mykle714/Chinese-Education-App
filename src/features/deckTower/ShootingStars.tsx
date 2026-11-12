import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box } from "@mui/material";
import { keyframes } from "@mui/material/styles";
import { ISO } from "./iso";

/**
 * ShootingStars — occasional meteors streaking across the night sky of the Deck Tower and
 * of the Add Cards page (docs/DECK_TOWER.md § "Time of day" → "Shooting stars").
 *
 * Layer: feature component (feature module `src/features/deckTower`), also mounted by
 * features/discover/AddCardsPage.tsx. Drawn in SCREEN space behind its page's content:
 * inside SpaceBackdrop on the tower, over the star field and behind the scene's svg, so
 * the tower and platform pass in front of a meteor rather than under it.
 *
 * How it works:
 *   - While `active` (timeOfDay.ts `shootingStars`: the look is mostly night), a timer
 *     ticks every `ROLL_INTERVAL_MS` (5 s) and each tick fires a BURST with probability
 *     `BURST_CHANCE` (1%) — a rare event, ≈ one every 8 min of night on average. The first
 *     roll waits one full tick, so arriving at night doesn't fire one instantly.
 *   - A burst is 1–3 meteors, `STAGGER_MS` apart. Every meteor falls down-LEFT (one
 *     fixed radiant), so a burst reads as one event, not a scatter.
 *   - A meteor is a flat streak — a round head and a tapering tail polygon in `ISO.star`,
 *     no gradient or glow (the iso style has none) — that slides in a straight line along
 *     its heading and fades in and out by one CSS animation; it removes itself on
 *     `animationend`.
 *   - Skipped while the tab is hidden, and entirely under `prefers-reduced-motion`.
 *   - Feature testers fire a burst on demand (`burstRequest`, bumped by ShootingStarChip
 *     via DeckTowerPage → SpaceBackdrop), bypassing all of the above.
 *
 * State lives HERE, not in SpaceBackdrop, so a burst re-renders only this small layer —
 * never the backdrop's scroll-driven DOM writes or the scene.
 *
 * Depends on: iso/palette.ts (`ISO.star`). Depended on by: SpaceBackdrop.tsx (and through it
 * DeckTowerPage.tsx + ShootingStarChip.tsx for `burstRequest`),
 * features/discover/AddCardsPage.tsx. Fills its nearest positioned ancestor.
 */

/** A burst is rolled every `ROLL_INTERVAL_MS`, firing with probability `BURST_CHANCE`. */
const ROLL_INTERVAL_MS = 5_000;
const BURST_CHANCE = 0.01;
/** Meteors per burst, inclusive. */
const BURST_MIN = 1;
const BURST_MAX = 3;
/** Delay between successive meteors of one burst (uniform range). */
const STAGGER_MS = [180, 650] as const;
/** One meteor's flight (fast: a meteor is a flick, not a drift). */
const DURATION_MS = [420, 650] as const;
/** How far the head travels, px. */
const TRAVEL_PX = [150, 260] as const;
/** Degrees below horizontal the meteor falls at (always toward the left). */
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

interface ShootingStarsProps {
    /** Run the random night schedule (timeOfDay.ts `shootingStars`). */
    active: boolean;
    /**
     * Feature testing (ShootingStarChip): each change of this counter fires one burst NOW,
     * whatever `active`, the time of day or `prefers-reduced-motion` — a tester who taps the
     * chip must see the meteors. Pair it with the time-of-day row's Night to see them as
     * the learner does (by day the white streaks are faint against the sky).
     */
    burstRequest?: number;
}

const ShootingStars: React.FC<ShootingStarsProps> = ({ active, burstRequest = 0 }) => {
    const [meteors, setMeteors] = useState<Meteor[]>([]);
    const nextId = useRef(0);
    // Every pending timer (the next roll and any staggered meteors), shared by the night
    // schedule and the tester trigger so one cleanup can clear them all.
    const timers = useRef(new Set<number>());

    const later = useCallback((fn: () => void, ms: number) => {
        const id = window.setTimeout(() => {
            timers.current.delete(id);
            fn();
        }, ms);
        timers.current.add(id);
    }, []);

    /** Queues one burst of 1–3 meteors, `STAGGER_MS` apart. */
    const fireBurst = useCallback(() => {
        const count = BURST_MIN + Math.floor(Math.random() * (BURST_MAX - BURST_MIN + 1));
        let at = 0;
        for (let i = 0; i < count; i++) {
            const meteor: Meteor = {
                id: nextId.current++,
                // Always falls left, so it starts in the right part of the sky to have
                // room to cross the screen.
                x: 0.35 + Math.random() * 0.6,
                y: Math.random() * SPAWN_TOP_MAX,
                // Mirrored about the vertical: 180° − fall heads down-left.
                angle: 180 - between(ANGLE_DEG),
                travel: between(TRAVEL_PX),
                tail: between(TAIL_PX),
                duration: between(DURATION_MS),
            };
            later(() => setMeteors((m) => [...m, meteor]), at);
            at += between(STAGGER_MS);
        }
    }, [later]);

    // The night schedule: one roll per tick; a hit fires a burst. The loop reschedules
    // itself either way.
    useEffect(() => {
        if (!active || prefersReducedMotion()) return;
        let rollTimer = 0;
        const schedule = () => {
            rollTimer = window.setTimeout(() => {
                if (document.visibilityState === "visible" && Math.random() < BURST_CHANCE) fireBurst();
                schedule();
            }, ROLL_INTERVAL_MS);
        };
        schedule();
        return () => {
            window.clearTimeout(rollTimer);
            // Leaving night mid-flight drops the meteors (and any still staggered) rather
            // than letting them finish over a sky that is no longer night.
            timers.current.forEach((id) => window.clearTimeout(id));
            timers.current.clear();
            setMeteors([]);
        };
    }, [active, fireBurst]);

    // The tester trigger. Compared against the last value seen, not against 0, so a
    // remount with a non-zero counter does not fire a phantom burst.
    const lastRequest = useRef(burstRequest);
    useEffect(() => {
        if (burstRequest === lastRequest.current) return;
        lastRequest.current = burstRequest;
        fireBurst();
    }, [burstRequest, fireBurst]);

    // Unmount: drop every pending timer.
    useEffect(() => {
        const pending = timers.current;
        return () => pending.forEach((id) => window.clearTimeout(id));
    }, []);

    const remove = (id: number) => setMeteors((m) => m.filter((x) => x.id !== id));

    return (
        <Box className="shooting-stars" sx={{ position: "absolute", inset: 0, overflow: "hidden" }}>
            {meteors.map((m) => (
                // A zero-size anchor at the head, rotated to the heading; the streak is drawn
                // pointing +x with its tail trailing back along -x.
                <Box
                    key={m.id}
                    className="shooting-stars__meteor"
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
