import { useEffect, useRef } from "react";
import { CARD_DISMISS_THRESHOLD_VW, CARD_DRAG_SENSITIVITY, CARD_FLY_OUT_MS } from "../constants";
import {
    isFlpRecordingOn,
    rectOf,
    sendGestureRecords,
    watchGestures,
    type RawGesture,
} from "../../../utils/gestureRecorder";

/**
 * The live flp's half of the swipe lab: records real study gestures on the card stack and
 * probes what clips the card while it is dragged and while it flies out.
 *
 * OFF unless this device opted in from /swipe-lab (`isFlpRecordingOn`, read once per
 * mount); off, the hook attaches nothing and every effect returns at its first line.
 *
 * Two record kinds, both to POST /api/diagnostics/gestures:
 *   • `flp-gesture` — the raw samples of one gesture that STARTED on the card frame, the
 *     verdict the production hook (useCardDrag) reached, read back from the props it
 *     drives (flyOut → dismiss, shakeNonce → shake, isFlipped → flip, else snap-back),
 *     every dragPosition commit, and the front card's rect each frame of the drag.
 *   • `flp-flyout` — on each fly-out: the flying card's rect every frame of the animation,
 *     the viewport, and every ancestor that can clip it (overflow ≠ visible, a clip-path,
 *     or paint containment) with its rect. A card rect crossing a clipper's edge while
 *     still inside the viewport is a visible clip — the "fly-out gets cut off" report.
 *
 * Unlabeled by nature (the learner just studies); /swipe-lab supplies the labeled set.
 * Mounted by FlashCardSection. Docs: docs/SWIPE_LAB.md.
 */

interface ProbeInput {
    flyOut: { slot: 0 | 1; direction: "left" | "right"; armed: boolean } | null;
    shakeNonce: number;
    isFlipped: boolean;
    dragPosition: { x: number; y: number };
}

type FlpVerdict = "flip" | "shake" | "dismiss-right" | "dismiss-left" | "snap-back";

/** As in the lab: the hook decides in touchend, its effects commit a render later. */
const VERDICT_SETTLE_MS = 200;
const FRAME_SELECTOR = ".mobile-demo-card-frame";
const MAX_RECT_SAMPLES = 120;

const now1 = () => Math.round(performance.now() * 10) / 10;

/** Every ancestor of `el` that can clip it, outermost last. */
function clipChain(el: Element) {
    const chain: { cls: string; overflow: string; clipPath?: string; contain?: string; rect: ReturnType<typeof rectOf> }[] = [];
    for (let node = el.parentElement; node; node = node.parentElement) {
        const cs = getComputedStyle(node);
        const overflow = `${cs.overflowX}/${cs.overflowY}`;
        const clips = cs.overflowX !== "visible" || cs.overflowY !== "visible";
        const clipPath = cs.clipPath && cs.clipPath !== "none" ? cs.clipPath : undefined;
        const contain = /paint|strict|content/.test(cs.contain) ? cs.contain : undefined;
        if (clips || clipPath || contain) {
            chain.push({
                // The first two class names identify the element (the rest are emotion hashes).
                cls: (typeof node.className === "string" ? node.className : "").split(/\s+/).filter((c) => !c.startsWith("css-")).slice(0, 2).join(" ") || node.tagName.toLowerCase(),
                overflow,
                clipPath,
                contain,
                rect: rectOf(node),
            });
        }
    }
    return chain;
}

/** Sample `pick()`'s rect every animation frame until `stop()` is called. */
function sampleRects(pick: () => Element | null) {
    const samples: { t: number; l: number; t0: number; r: number; b: number }[] = [];
    let raf = 0;
    const tick = () => {
        const el = pick();
        if (el && samples.length < MAX_RECT_SAMPLES) {
            const r = rectOf(el);
            // `t0` is the rect's top; `t` is the timestamp.
            samples.push({ t: now1(), l: r.l, t0: r.t, r: r.r, b: r.b });
        }
        raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return { samples, stop: () => cancelAnimationFrame(raf) };
}

export function useFlpGestureProbe({ flyOut, shakeNonce, isFlipped, dragPosition }: ProbeInput): void {
    // Read once: flipping the toggle takes effect on the next flp visit.
    const enabledRef = useRef<boolean | null>(null);
    if (enabledRef.current === null) enabledRef.current = isFlpRecordingOn();
    const enabled = enabledRef.current;

    // The gesture in flight (finger down → verdict read), or null.
    const armedRef = useRef(false);
    const verdictRef = useRef<FlpVerdict | null>(null);
    const commitsRef = useRef<{ t: number; x: number; y: number }[]>([]);
    const seqRef = useRef(0);
    const startedFlippedRef = useRef(false);
    const isFlippedRef = useRef(isFlipped);
    isFlippedRef.current = isFlipped;

    // ── Verdict, read back from the props useCardDrag drives ───────────────────────────
    // When the dismiss committed (un-armed fly-out) — the arming lag is measured from here.
    const flyCommitAtRef = useRef<number | null>(null);
    useEffect(() => {
        if (!enabled || !flyOut) return;
        if (armedRef.current && !verdictRef.current) {
            verdictRef.current = flyOut.direction === "right" ? "dismiss-right" : "dismiss-left";
        }
        // One record per fly-out: note the dismiss commit, sample once it is armed.
        if (!flyOut.armed) {
            flyCommitAtRef.current = now1();
            return;
        }
        const armedAt = now1();
        const commitAt = flyCommitAtRef.current;

        // Fly-out clip probe — runs for every fly-out, armed or not (a tap-dismissed
        // writing card flies too).
        const frame = document.querySelector(FRAME_SELECTOR);
        const pick = () => frame?.querySelector('[data-card-role="flying"]') ?? null;
        const first = pick();
        const chain = first ? clipChain(first) : [];
        const rects = sampleRects(pick);
        const seq = seqRef.current;
        // NOT cancelled when flyOut clears: the loop clears it at CARD_FLY_OUT_MS, before
        // this fires (that cancellation lost every fly-out record on the first run).
        window.setTimeout(() => {
            rects.stop();
            void sendGestureRecords([{
                kind: "flp-flyout",
                // The gesture that caused it, when there was one.
                seq,
                direction: flyOut.direction,
                // performance.now() of the dismiss commit and of arming; rects[].t share it.
                commitAt,
                armedAt,
                viewport: { w: window.innerWidth, h: window.innerHeight, vvH: window.visualViewport?.height },
                frameRect: frame ? rectOf(frame) : null,
                clipChain: chain,
                rects: rects.samples,
            }]);
        }, CARD_FLY_OUT_MS + 60);
    }, [enabled, flyOut]);

    useEffect(() => {
        if (enabled && armedRef.current && shakeNonce > 0 && !verdictRef.current) verdictRef.current = "shake";
    }, [enabled, shakeNonce]);

    const prevFlippedRef = useRef(isFlipped);
    useEffect(() => {
        if (enabled && armedRef.current && isFlipped && !prevFlippedRef.current && !verdictRef.current) verdictRef.current = "flip";
        prevFlippedRef.current = isFlipped;
    }, [enabled, isFlipped]);

    useEffect(() => {
        if (enabled && armedRef.current && commitsRef.current.length < 300) {
            commitsRef.current.push({ t: now1(), x: Math.round(dragPosition.x), y: Math.round(dragPosition.y) });
        }
    }, [enabled, dragPosition]);

    // ── Gesture capture ────────────────────────────────────────────────────────────────
    useEffect(() => {
        if (!enabled) return;
        let dragRects: ReturnType<typeof sampleRects> | null = null;

        const onStart = () => {
            armedRef.current = true;
            verdictRef.current = null;
            commitsRef.current = [];
            startedFlippedRef.current = isFlippedRef.current;
            const frame = document.querySelector(FRAME_SELECTOR);
            dragRects = sampleRects(() => frame?.querySelector('[data-card-role="front"]') ?? null);
        };
        const onEnd = (g: RawGesture) => {
            const rects = dragRects;
            dragRects = null;
            window.setTimeout(() => {
                rects?.stop();
                armedRef.current = false;
                const seq = ++seqRef.current;
                const frame = document.querySelector(FRAME_SELECTOR) as HTMLElement | null;
                void sendGestureRecords([{
                    kind: "flp-gesture",
                    seq,
                    verdict: verdictRef.current ?? "snap-back",
                    cardStartedFlipped: startedFlippedRef.current,
                    classifier: {
                        dismissThresholdFrac: CARD_DISMISS_THRESHOLD_VW,
                        sensitivity: CARD_DRAG_SENSITIVITY,
                        cardWidth: frame?.offsetWidth ?? 0,
                    },
                    cardRect: frame ? rectOf(frame) : null,
                    gesture: g,
                    commits: commitsRef.current,
                    dragRects: rects?.samples ?? [],
                }]);
            }, VERDICT_SETTLE_MS);
        };
        const startsOnCard = (e: TouchEvent) =>
            e.target instanceof Element && e.target.closest(FRAME_SELECTOR) !== null;

        const detach = watchGestures(document, onEnd, onStart, startsOnCard);
        return () => {
            detach();
            dragRects?.stop();
        };
    }, [enabled]);
}
