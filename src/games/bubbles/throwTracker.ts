import type { BubbleBody } from "./types";
import { THROW_MAX_SPEED, THROW_SAMPLE_WINDOW_MS, THROW_STALE_MS } from "./constants";

/**
 * Bubbles — the THROW: turning a drag into a release velocity (air hockey).
 *
 * Both bubble stages record the HELD BUBBLE'S center (post-clamp, not the raw
 * pointer) on every pointermove, then on release call `ThrowTracker.applyTo` for any
 * drop that is not judged as a match. Recording the bubble rather than the pointer means a drag
 * pinned against `clampHeldCenter`'s limit throws at the speed the bubble was
 * actually moving, not the speed the finger was.
 *
 * The velocity is the displacement across the trailing THROW_SAMPLE_WINDOW_MS —
 * averaging over a window, not the last two events, because touch pointermoves
 * arrive unevenly and the last pair alone can spike. A pointer that paused
 * THROW_STALE_MS before lifting throws nothing (it was placed, not flung).
 *
 * Referenced by: src/games/hydra-bubbles/HydraStage.tsx,
 * src/games/bubble-match/BubbleStage.tsx. Physics side: physics.ts → stepPhysics
 * (the glide regime). Docs: docs/GAMES_FEATURE.md, docs/HYDRA_BUBBLES.md § 1.
 */

interface ThrowSample {
    t: number;
    x: number;
    y: number;
}

/** A per-drag sample buffer. One lives in a ref per stage; `reset` on each grab. */
export class ThrowTracker {
    private samples: ThrowSample[] = [];

    /** Start a new drag at the grabbed bubble's position. */
    reset(x: number, y: number, t: number = performance.now()): void {
        this.samples = [{ t, x, y }];
    }

    /** Record the held bubble's center after a move. Prunes samples too old to
        matter, keeping one just outside the window as the displacement anchor. */
    record(x: number, y: number, t: number = performance.now()): void {
        this.samples.push({ t, x, y });
        const cutoff = t - THROW_SAMPLE_WINDOW_MS;
        while (this.samples.length > 2 && this.samples[1].t <= cutoff) this.samples.shift();
    }

    /** The release velocity (px/sec), capped at THROW_MAX_SPEED. Zero for a release
        that paused first or had no motion to measure. */
    velocity(now: number = performance.now()): { vx: number; vy: number } {
        const last = this.samples[this.samples.length - 1];
        if (!last || now - last.t > THROW_STALE_MS) return { vx: 0, vy: 0 };
        const cutoff = last.t - THROW_SAMPLE_WINDOW_MS;
        // Oldest sample inside the window. When `last` is the ONLY one inside it
        // (sparse pointermoves on a slow device), step back to the anchor just
        // outside it rather than measuring a zero-length span as "no throw".
        let i = this.samples.findIndex((s) => s.t >= cutoff);
        if (i === this.samples.length - 1 && i > 0) i -= 1;
        const first = this.samples[Math.max(0, i)];
        const span = (last.t - first.t) / 1000;
        if (span <= 0) return { vx: 0, vy: 0 };
        let vx = (last.x - first.x) / span;
        let vy = (last.y - first.y) / span;
        const sp = Math.hypot(vx, vy);
        if (sp > THROW_MAX_SPEED) {
            vx *= THROW_MAX_SPEED / sp;
            vy *= THROW_MAX_SPEED / sp;
        }
        return { vx, vy };
    }

    /** Hand `body` the release velocity. The caller does this ONLY for an unjudged
        release — a drop onto an opposite-kind bubble is a match attempt, and its
        bubbles keep their pre-grab velocity through the pop/shake. */
    applyTo(body: BubbleBody): void {
        const { vx, vy } = this.velocity();
        body.vx = vx;
        body.vy = vy;
        this.samples = [];
    }
}
