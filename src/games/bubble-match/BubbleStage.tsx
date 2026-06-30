import React, { useCallback, useEffect, useRef, useState } from "react";
import { COLORS } from "../../theme/colors";
import { Box, Typography } from "@mui/material";
import { SIZE, WEIGHT } from "../../theme/scale";
import type { VocabEntry } from "../../types";
import { stripParentheses } from "../../utils/definitionUtils";
import Bubble from "./Bubble";
import { stepPhysics, planSpawn, fillRatio, randRange, type Bounds } from "./physics";
import { selectNextBubble } from "./spawnSelection";
import type { BubbleBody, LevelConfig } from "./types";
import {
    WORD_RADIUS_MIN,
    WORD_RADIUS_MAX,
    WORD_LEN_MIN,
    WORD_LEN_MAX,
    WORD_RADIUS_JITTER,
    DEFINITION_RADIUS_MIN,
    DEFINITION_RADIUS_MAX,
    DEFINITION_LEN_MIN,
    DEFINITION_LEN_MAX,
    DEFINITION_RADIUS_JITTER,
    MAX_DT,
    SPAWN_SEED_RADIUS,
    SCALE_IDLE,
    SCALE_HELD,
    SCALE_HOVER,
    SCALE_LERP,
    DANGER_FILL_RATIO,
    LOSE_FILL_RATIO,
    OVERFILL_RESIDUAL_PX,
    OVERFILL_SUSTAIN_MS,
    POP_DURATION_MS,
    WRONG_FEEDBACK_MS,
    CANCEL_ZONE_HEIGHT,
    POST_DONE_SETTLE_MS,
    MIN_PLAY_HEIGHT,
} from "./constants";

interface BubbleStageProps {
    /** The pairs (vocab entries) tested in this level. */
    levelPairs: VocabEntry[];
    config: LevelConfig;
    levelNumber: number;
    levelLabel: string;
    showPinyin: boolean;
    showPinyinColor: boolean;
    /** Called to narrate a word bubble's Chinese on pickup / match-onto.
        Undefined when autoplay is off. */
    onSpeak?: (entry: VocabEntry) => void;
    onLevelWin: () => void;
    /** Called when the descending ceiling packs the field past the point of
        recovery (the only loss path — there is no clock). */
    onLevelLose: () => void;
    /** Record a flashcard mark for a matched/mismatched bubble's vocab entry.
        Mirrors the flp mark endpoint: correct match → success, wrong match →
        incorrect. Not called for study-mode taps after the game ends. */
    onMark?: (entry: VocabEntry, isCorrect: boolean) => void;
    /** Study mode: the game is over and its popup is minimized, so the player can
        tap (mobile) / hover (desktop) a bubble to highlight it and its match. */
    studyMode: boolean;
}

let bodySeq = 0;

/**
 * Map a text length onto a bubble radius so wordier content gets a roomier
 * circle. `len` is normalized across [lenMin, lenMax] (clamped at both ends),
 * then interpolated across the [radiusMin, radiusMax] band *inset* by `jitter`,
 * and finally a small ± jitter is added back so two same-length bubbles don't
 * render as identical circles. Insetting first guarantees the jitter always has
 * room and the final value stays in band — even the shortest and longest texts
 * keep some variance. Shared by both bubble kinds (English definitions and
 * Chinese words) so they scale with their text the same way.
 */
function lengthScaledRadius(
    len: number,
    lenMin: number,
    lenMax: number,
    radiusMin: number,
    radiusMax: number,
    jitter: number
): number {
    const t = Math.max(0, Math.min(1, (len - lenMin) / (lenMax - lenMin)));
    const lo = radiusMin + jitter;
    const hi = radiusMax - jitter;
    const base = lo + t * (hi - lo);
    return base + randRange(-jitter, jitter);
}

/** Radius for a definition bubble, scaled to the length of its English text. */
function definitionRadius(entry: VocabEntry): number {
    const len = stripParentheses(entry.definition ?? "").length;
    return lengthScaledRadius(
        len,
        DEFINITION_LEN_MIN,
        DEFINITION_LEN_MAX,
        DEFINITION_RADIUS_MIN,
        DEFINITION_RADIUS_MAX,
        DEFINITION_RADIUS_JITTER
    );
}

/** Radius for a word bubble, scaled to its Chinese character count. */
function wordRadius(entry: VocabEntry): number {
    // Count by code points so multi-byte CJK characters each count once.
    const len = [...(entry.entryKey ?? "")].length;
    return lengthScaledRadius(
        len,
        WORD_LEN_MIN,
        WORD_LEN_MAX,
        WORD_RADIUS_MIN,
        WORD_RADIUS_MAX,
        WORD_RADIUS_JITTER
    );
}

function makeBody(
    pairId: string,
    kind: "word" | "definition",
    entry: VocabEntry,
    radius: number
): BubbleBody {
    return {
        id: `b${bodySeq++}`,
        pairId,
        kind,
        entry,
        x: 0,
        y: 0,
        // Start at the seed size; the bubble inflates to targetRadius once spawned.
        radius: SPAWN_SEED_RADIUS,
        targetRadius: radius,
        mass: radius * radius, // ∝ full-size area (π constant drops out)
        scale: SCALE_IDLE,
        targetScale: SCALE_IDLE,
        status: "idle",
    };
}

/**
 * One level's playfield. Owns the physics loop, the timed bubble launcher, the
 * descending ceiling (which closes in once the whole pool is out), and all
 * drag/match interaction. Reports up via onLevelWin / onLevelLose; the page
 * handles progression and re-mounts the stage per level (keyed on level number)
 * so each level starts from a clean slate.
 */
const BubbleStage: React.FC<BubbleStageProps> = ({
    levelPairs,
    config,
    levelNumber,
    levelLabel,
    showPinyin,
    showPinyinColor,
    onSpeak,
    onLevelWin,
    onLevelLose,
    onMark,
    studyMode,
}) => {
    const stageRef = useRef<HTMLDivElement>(null);
    // The visible descending "lid". Its height is written directly each frame (in
    // the rAF loop, like the bubbles) to match boundsRef.top without re-rendering.
    const ceilingNodeRef = useRef<HTMLDivElement>(null);

    // Physics + interaction source of truth (mutated in place; never per-frame state).
    const bodiesRef = useRef<BubbleBody[]>([]);
    const queueRef = useRef<BubbleBody[]>([]);
    const nodeMapRef = useRef<Map<string, HTMLDivElement>>(new Map());
    // Play bounds: width + walls, with height EXCLUDING the bottom cancel strip
    // (height = stage height − CANCEL_ZONE_HEIGHT) and a `top` wall that descends
    // once the pool is out. Everything physics cares about (spawn inset, wall
    // clamp, fill ratio) reads this, so the strip is outside play.
    const boundsRef = useRef<Bounds>({ width: 0, top: 0, height: 0 });
    // Flips true on the first launch-tick after the queue drains: from then on the
    // rAF loop lowers boundsRef.top (the ceiling) at config.shrinkSpeedPxPerSec.
    const shrinkingRef = useRef(false);
    // Full measured stage height (including the strip). Used only to let a *held*
    // bubble be dragged down into the strip while every settled body stays in play.
    const fullHeightRef = useRef(0);

    // Interaction refs.
    const heldIdRef = useRef<string | null>(null);
    const hoveredIdRef = useRef<string | null>(null);
    // Study mode (mirrors the prop) and the pair currently highlighted green.
    // Kept in refs so the pointer handlers can stay stable (memoized once).
    const studyModeRef = useRef(studyMode);
    const revealedPairRef = useRef<string | null>(null);
    // Desktop hover-select guard. When the game-over popup collapses, the element
    // under a *stationary* cursor changes from the card/× to the bubble behind it,
    // and the browser fires a synthetic pointerenter on that bubble with no
    // accompanying pointermove. Honoring it would auto-select a pair the instant
    // the player hits ×. So we "arm" hover only after a genuine pointermove in
    // study mode, and ignore enters until then.
    const hoverArmedRef = useRef(false);
    const grabOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
    const stageRectRef = useRef<DOMRect | null>(null);

    // Lifecycle/control refs.
    const phaseRef = useRef<"playing" | "done">("playing");
    const matchedRef = useRef(0);
    const pendingTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
    // Timestamp (perf.now) when residual overlap first crossed the overfill
    // threshold; null while it's under. Drives the sustained-residual loss path.
    const overfillSinceRef = useRef<number | null>(null);

    // React state used only for renders the DOM-write loop can't cover.
    const [, setTick] = useState(0);
    const forceRender = useCallback(() => setTick((t) => t + 1), []);
    const [danger, setDanger] = useState(false);
    // Latches true the first time the player enters study mode (collapses the
    // game-over popup to inspect the field). Once dismissed, the red danger glow
    // never returns for the rest of the run — re-expanding the popup won't flash it.
    const [dangerDismissed, setDangerDismissed] = useState(false);
    const [matched, setMatched] = useState(0);
    // True while the currently-held bubble overlaps the bottom cancel strip — drives
    // the strip's hover tint. Pure feedback; does not affect match logic.
    const [overCancelZone, setOverCancelZone] = useState(false);

    const totalPairs = levelPairs.length;

    // Stable callback for bubble nodes to register/unregister their DOM element.
    const registerNode = useCallback((id: string, el: HTMLDivElement | null) => {
        if (el) nodeMapRef.current.set(id, el);
        else nodeMapRef.current.delete(id);
    }, []);

    // Write a single body's translate+scale to its DOM node. Shared by the rAF
    // loop (every floating bubble, once per frame) and the pointermove handler
    // (the held bubble, on every pointer event) so a dragged bubble tracks the
    // pointer at the pointer-event rate instead of lagging a frame behind it.
    const writeTransform = useCallback((b: BubbleBody) => {
        const node = nodeMapRef.current.get(b.id);
        if (node) {
            // The DOM node is laid out at full (targetRadius) size; the grow-in is
            // expressed as a scale (radius/targetRadius) so it animates without a
            // React re-layout. Scaling about the node's center keeps the visual
            // center pinned at (x, y), so we translate by targetRadius, not radius.
            const grow = b.targetRadius > 0 ? b.radius / b.targetRadius : 1;
            node.style.transform = `translate(${b.x - b.targetRadius}px, ${b.y - b.targetRadius}px) scale(${grow * b.scale})`;
        }
    }, []);

    const finishLevel = useCallback(
        (outcome: "win" | "lose") => {
            if (phaseRef.current === "done") return;
            phaseRef.current = "done";

            // Force-drop a bubble the player is still holding at the buzzer. Without
            // this, the in-flight drag stays live and its eventual pointerup would
            // resolve a match after the run is already over (the onUp guard below is
            // the other half of this). Settle the held bubble — and any lit hover
            // target — back to idle so the field freezes in a clean state; the
            // physics wall-clamp then lifts it out of the cancel strip next frame.
            const heldId = heldIdRef.current;
            if (heldId) {
                heldIdRef.current = null;
                const held = bodiesRef.current.find((b) => b.id === heldId);
                if (held) {
                    held.status = "idle";
                    held.targetScale = SCALE_IDLE;
                }
                const hoveredId = hoveredIdRef.current;
                if (hoveredId) {
                    const hov = bodiesRef.current.find((b) => b.id === hoveredId);
                    if (hov && hov.status === "hovered") {
                        hov.status = "idle";
                        hov.targetScale = SCALE_IDLE;
                    }
                }
                hoveredIdRef.current = null;
                setOverCancelZone(false);
                forceRender();
            }

            if (outcome === "win") onLevelWin();
            else onLevelLose();
        },
        [onLevelWin, onLevelLose, forceRender]
    );

    // ---- Main setup: build queue, start loops. Re-runs per level. -----------
    useEffect(() => {
        phaseRef.current = "playing";
        matchedRef.current = 0;
        setMatched(0);
        setDanger(false);
        setDangerDismissed(false);
        bodiesRef.current = [];
        nodeMapRef.current.clear();
        heldIdRef.current = null;
        hoveredIdRef.current = null;
        overfillSinceRef.current = null;
        shrinkingRef.current = false;
        boundsRef.current.top = 0;
        setOverCancelZone(false);

        // Build all bubbles for the level (word + definition per pair). Launch
        // order is decided dynamically by selectNextBubble, not by array order.
        const built: BubbleBody[] = [];
        levelPairs.forEach((entry, idx) => {
            const pairId = `${entry.id}-${idx}`;
            built.push(makeBody(pairId, "word", entry, wordRadius(entry)));
            built.push(makeBody(pairId, "definition", entry, definitionRadius(entry)));
        });
        queueRef.current = built;

        // Measure the stage.
        const measure = () => {
            const rect = stageRef.current?.getBoundingClientRect();
            if (rect) {
                fullHeightRef.current = rect.height;
                // Play area excludes the bottom cancel strip — this makes the
                // boundary a wall for spawning, collision push-back, and overfill.
                // Preserve the descending ceiling's `top` across resizes.
                boundsRef.current = {
                    width: rect.width,
                    top: boundsRef.current.top,
                    height: rect.height - CANCEL_ZONE_HEIGHT,
                };
            }
        };
        measure();
        window.addEventListener("resize", measure);

        // Spawn one bubble: choose which (kind + match bias, see spawnSelection),
        // remove it from the queue, pick a location with planSpawn (the "20% rule"
        // overlap check), and set it growing in place from the seed size — it's
        // infinite-mass while growing, so it shoves the bubbles it overlaps to make
        // room. No game-over here: overfill is judged each frame from packing +
        // residual, and a too-full board just spawns at the least-bad spot.
        const spawnOne = () => {
            if (phaseRef.current !== "playing") return;
            const next = selectNextBubble(queueRef.current, bodiesRef.current);
            if (!next) return; // queue drained — nothing left to spawn
            queueRef.current = queueRef.current.filter((b) => b.id !== next.id);
            const { x, y } = planSpawn(next.targetRadius, boundsRef.current, bodiesRef.current);
            next.x = x;
            next.y = y;
            next.radius = SPAWN_SEED_RADIUS;
            next.status = "growing";
            bodiesRef.current.push(next);
            forceRender();
        };

        // Spawn the first immediately, then on the level's cadence. The tick that
        // finds the queue already drained is "the tick the next bubble would have
        // launched on" — instead of spawning, it starts the ceiling descending and
        // stops the launcher (nothing left to spawn). From here the only way the run
        // ends is a win (field cleared) or the descending ceiling jamming the field.
        spawnOne();
        const launchTimer = setInterval(() => {
            if (phaseRef.current !== "playing") return;
            if (queueRef.current.length === 0) {
                shrinkingRef.current = true;
                clearInterval(launchTimer);
                return;
            }
            spawnOne();
        }, config.launchIntervalMs);

        // rAF physics + transform-write loop.
        let raf = 0;
        let last = performance.now();
        // perf.now() when the run ended (phase → done); 0 while still playing.
        // Drives the post-run loop shutdown (see the bottom of frame()).
        let doneSince = 0;
        const frame = (now: number) => {
            const dt = Math.min((now - last) / 1000, MAX_DT);
            last = now;
            const bodies = bodiesRef.current;
            const bounds = boundsRef.current;

            // Lower the ceiling once the whole pool has launched. It presses the
            // field down (via the top wall clamp in stepPhysics) and shrinks the
            // play area, driving the fill ratio up toward the overfill loss. With
            // MIN_PLAY_HEIGHT === 0 the ceiling closes the area completely, so any
            // bubbles still on the field force a loss (fillRatio returns 1 once the
            // play area hits 0 height). The visible lid tracks bounds.top below
            // (written like a bubble transform, no re-render).
            if (shrinkingRef.current && phaseRef.current === "playing") {
                const maxTop = bounds.height - MIN_PLAY_HEIGHT;
                bounds.top = Math.min(bounds.top + config.shrinkSpeedPxPerSec * dt, maxTop);
            }

            const residual = stepPhysics(bodies, dt, bounds);

            // Drop the visible lid to the ceiling line (its height === bounds.top).
            const ceiling = ceilingNodeRef.current;
            if (ceiling) ceiling.style.height = `${bounds.top}px`;

            // Smoothly approach each bubble's target scale and write transforms.
            // Track whether anything is still mid-animation so the loop can stop
            // itself once the field goes static (see the shutdown check below).
            let anyAnimating = false;
            for (const b of bodies) {
                b.scale += (b.targetScale - b.scale) * SCALE_LERP;
                // Snap to target once within epsilon so the asymptotic lerp
                // actually reaches "settled" instead of crawling forever.
                if (Math.abs(b.targetScale - b.scale) < 0.001) b.scale = b.targetScale;
                else anyAnimating = true;
                if (b.status === "growing") anyAnimating = true;
                writeTransform(b);
            }

            // Overfill detection — two independent signals, checked every frame:
            //   (A) Area packing: coverage past LOSE_FILL_RATIO is unwinnable.
            //   (B) Sustained residual: the separation solver can't pull pairs
            //       apart (residual stays high) for OVERFILL_SUSTAIN_MS straight.
            const ratio = fillRatio(bodies, bounds);
            if (phaseRef.current === "playing") {
                if (residual >= OVERFILL_RESIDUAL_PX) {
                    if (overfillSinceRef.current === null) overfillSinceRef.current = now;
                } else {
                    overfillSinceRef.current = null; // recovered — reset the sustain clock
                }
                const stuckTooLong =
                    overfillSinceRef.current !== null &&
                    now - overfillSinceRef.current >= OVERFILL_SUSTAIN_MS;
                if (ratio >= LOSE_FILL_RATIO || stuckTooLong) {
                    finishLevel("lose");
                }
            }

            // Danger glow when the field is getting full (warning, below the loss line).
            const isDanger = ratio >= DANGER_FILL_RATIO;
            setDanger((prev) => (prev === isDanger ? prev : isDanger));

            // Post-run shutdown: once the run is over the stage stays mounted
            // behind the popup, but a still-running per-frame transform-write
            // loop over ~40 nodes competes with the popup's buttons for the main
            // thread. Stop rescheduling as soon as the field stops moving (no
            // scale animation / growth). The over-packed loss never fully settles
            // (the solver stays stuck), so a hard grace cap freezes it anyway —
            // the run is already decided. While playing we always continue.
            if (phaseRef.current === "done") {
                if (doneSince === 0) doneSince = now;
                const settled = !anyAnimating;
                const graceElapsed = now - doneSince >= POST_DONE_SETTLE_MS;
                if (settled || graceElapsed) return; // leave the loop stopped
            }

            raf = requestAnimationFrame(frame);
        };
        raf = requestAnimationFrame(frame);

        return () => {
            window.removeEventListener("resize", measure);
            clearInterval(launchTimer);
            cancelAnimationFrame(raf);
            pendingTimeoutsRef.current.forEach(clearTimeout);
            pendingTimeoutsRef.current = [];
        };
        // levelNumber identifies the level; config/levelPairs change with it.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [levelNumber]);

    // ---- Pointer interaction (drag → hover → match) ------------------------
    // Only an opposite-kind bubble (Chinese word ↔ English definition) is ever a
    // hover/match target. A same-kind bubble can never form a pair, so we don't
    // highlight it (no enlarge/grey) and dropping onto it yields no target —
    // letting it fall through to plain collision physics instead of a doomed
    // match attempt.
    const findHoverTarget = useCallback((held: BubbleBody): BubbleBody | null => {
        let best: BubbleBody | null = null;
        let bestDist = Infinity;
        for (const b of bodiesRef.current) {
            if (b.id === held.id) continue;
            if (b.kind === held.kind) continue; // same type can't match — ignore for hover/drop
            // Skip bubbles mid-match and ones still growing into place.
            if (b.status === "correct" || b.status === "wrong" || b.status === "growing") continue;
            const d = Math.hypot(b.x - held.x, b.y - held.y);
            if (d < held.radius + b.radius && d < bestDist) {
                best = b;
                bestDist = d;
            }
        }
        return best;
    }, []);

    const setStatus = useCallback(
        (body: BubbleBody, status: BubbleBody["status"], targetScale: number) => {
            body.status = status;
            body.targetScale = targetScale;
        },
        []
    );

    // ---- Study mode (game over + popup minimized) --------------------------
    // Highlight a single pair green for reference. Clearing first and re-applying
    // keeps "only one pair lit at a time" without tracking individual bubble ids.
    const setRevealedPair = useCallback(
        (pairId: string | null) => {
            if (revealedPairRef.current === pairId) return;
            // Drop the previously-lit pair back to floating.
            if (revealedPairRef.current) {
                for (const b of bodiesRef.current) {
                    if (b.pairId === revealedPairRef.current && b.status === "revealed") {
                        setStatus(b, "idle", SCALE_IDLE);
                    }
                }
            }
            revealedPairRef.current = pairId;
            // Light up both halves of the newly-selected pair.
            if (pairId) {
                for (const b of bodiesRef.current) {
                    if (b.pairId === pairId) setStatus(b, "revealed", SCALE_IDLE);
                }
            }
            forceRender();
        },
        [setStatus, forceRender]
    );

    // Keep the ref in sync and tear the highlight down when study mode ends
    // (popup re-expanded or a new run started).
    useEffect(() => {
        studyModeRef.current = studyMode;
        // Re-arming each time study mode toggles ensures the synthetic enter that
        // fires as the popup collapses (no real move) is never honored.
        hoverArmedRef.current = false;
        // Entering study mode permanently dismisses the danger glow for this run.
        if (studyMode) setDangerDismissed(true);
        if (!studyMode) setRevealedPair(null);
    }, [studyMode, setRevealedPair]);

    // Selected bubble has no partner on screen — clear any green highlight and
    // give it the same red + shake "wrong" feedback used for a mismatched drop,
    // then settle it back to idle.
    const flashNoMatch = useCallback(
        (body: BubbleBody) => {
            setRevealedPair(null); // selecting a new bubble drops the previous pair
            // Red flash WITHOUT the shake — the tap was valid, there was just no
            // partner on screen (see the "nomatch" status). The shake is reserved
            // for an actual wrong drag-drop.
            setStatus(body, "nomatch", SCALE_IDLE);
            forceRender();
            // Still narrate the Chinese — a no-match word bubble is just as worth
            // hearing as a matched one (parity with the green-reveal path).
            if (body.kind === "word" && onSpeak) onSpeak(body.entry);
            const to = setTimeout(() => {
                // Only revert if it's still this same flash (not re-selected/removed).
                if (bodiesRef.current.includes(body) && body.status === "nomatch") {
                    setStatus(body, "idle", SCALE_IDLE);
                    forceRender();
                }
            }, WRONG_FEEDBACK_MS);
            pendingTimeoutsRef.current.push(to);
        },
        [setRevealedPair, setStatus, forceRender, onSpeak]
    );

    // Reveal a pair from a tap (mobile) or hover-enter (desktop).
    const onStudySelect = useCallback(
        (id: string) => {
            const body = bodiesRef.current.find((b) => b.id === id);
            if (!body) return;
            // The partner bubble (same pair) must currently be on screen to form a
            // green match. If it was never launched (still queued when the game
            // ended), there's nothing to pair with — flash red + shake instead.
            const partnerOnScreen = bodiesRef.current.some(
                (b) => b.id !== id && b.pairId === body.pairId
            );
            if (!partnerOnScreen) {
                flashNoMatch(body);
                return;
            }
            setRevealedPair(body.pairId);
            // Narrate the Chinese so study mode doubles as listening practice.
            if (body.kind === "word" && onSpeak) onSpeak(body.entry);
        },
        [setRevealedPair, onSpeak, flashNoMatch]
    );

    const onPointerDown = useCallback(
        (id: string, e: React.PointerEvent) => {
            // Study mode: a tap selects this bubble's pair instead of dragging.
            // Stop propagation so the stage-background handler doesn't immediately
            // clear the selection we just made.
            if (studyModeRef.current) {
                e.stopPropagation();
                onStudySelect(id);
                return;
            }
            if (phaseRef.current !== "playing") return;
            const body = bodiesRef.current.find((b) => b.id === id);
            // Can't grab a bubble mid-match, but a still-growing bubble IS grabbable:
            // grabbing it finishes its grow-in instantly (handled below).
            if (!body || body.status === "correct" || body.status === "wrong") return;

            const rect = stageRef.current?.getBoundingClientRect();
            if (!rect) return;
            stageRectRef.current = rect;

            // If the player grabs a bubble mid-grow, snap it to full size so it's
            // dragged (and matched) as a normal, complete bubble.
            if (body.status === "growing") body.radius = body.targetRadius;

            heldIdRef.current = id;
            const px = e.clientX - rect.left;
            const py = e.clientY - rect.top;
            grabOffsetRef.current = { x: px - body.x, y: py - body.y };

            setStatus(body, "held", SCALE_HELD);
            forceRender();

            // Autoplay: narrate the Chinese the moment a word bubble is picked up.
            if (body.kind === "word" && onSpeak) onSpeak(body.entry);
        },
        [forceRender, onSpeak, setStatus, onStudySelect]
    );

    // Desktop hover: highlight a pair on mouse-enter, clear it on mouse-leave.
    // Mouse-only so touch taps (which also emit enter/leave) stay tap-driven.
    const onBubbleEnter = useCallback(
        (id: string, e: React.PointerEvent) => {
            if (!studyModeRef.current || e.pointerType !== "mouse") return;
            // Ignore the synthetic re-target enter that fires when the popup
            // collapses under a stationary cursor — only a real hover (preceded by
            // a pointermove that armed it) should select.
            if (!hoverArmedRef.current) return;
            onStudySelect(id);
        },
        [onStudySelect]
    );
    const onBubbleLeave = useCallback(
        (_id: string, e: React.PointerEvent) => {
            if (!studyModeRef.current || e.pointerType !== "mouse") return;
            setRevealedPair(null);
        },
        [setRevealedPair]
    );

    // Tap/click on empty stage (not on a bubble — those stopPropagation) clears
    // the current highlight in study mode.
    const onStageBackgroundPointerDown = useCallback(() => {
        if (studyModeRef.current) setRevealedPair(null);
    }, [setRevealedPair]);

    // Arm desktop hover-select on the first genuine mouse movement in study mode.
    // The synthetic enter that fires when the popup collapses carries no move, so
    // it stays disarmed (see hoverArmedRef) until the player actually moves.
    const onStagePointerMove = useCallback((e: React.PointerEvent) => {
        if (studyModeRef.current && e.pointerType === "mouse") hoverArmedRef.current = true;
    }, []);

    // Window-level move/up so dragging continues outside the bubble's bounds.
    useEffect(() => {
        const onMove = (e: PointerEvent) => {
            const heldId = heldIdRef.current;
            if (!heldId) return;
            const held = bodiesRef.current.find((b) => b.id === heldId);
            const rect = stageRectRef.current;
            if (!held || !rect) return;

            const px = e.clientX - rect.left;
            const py = e.clientY - rect.top;

            // Move the held bubble's center to the pointer (minus grab offset). X and
            // the top stay on the play bounds, but the bottom is unclamped past the
            // stage edge: the player can drag a bubble fully off the bottom so even a
            // large bubble fits entirely within the (shorter) cancel strip. Settled
            // bodies still can't go there — only the held bubble is exempt.
            const bounds = boundsRef.current;
            const maxY = fullHeightRef.current + held.radius;
            held.x = Math.max(held.radius, Math.min(bounds.width - held.radius, px - grabOffsetRef.current.x));
            held.y = Math.max(held.radius, Math.min(maxY, py - grabOffsetRef.current.y));

            // Tint the cancel strip while the held bubble overlaps it (feedback only).
            const inZone = held.y + held.radius > bounds.height;
            setOverCancelZone((prev) => (prev === inZone ? prev : inZone));

            // Write the held bubble's transform now (not next frame) so the drag
            // tracks the pointer with zero added latency and never re-renders a
            // stale position between pointer events on a fast flick.
            held.scale += (held.targetScale - held.scale) * SCALE_LERP;
            writeTransform(held);

            // Update hover target highlight.
            const target = findHoverTarget(held);
            const prevHoverId = hoveredIdRef.current;
            if (target?.id !== prevHoverId) {
                if (prevHoverId) {
                    const prev = bodiesRef.current.find((b) => b.id === prevHoverId);
                    if (prev && prev.status === "hovered") setStatus(prev, "idle", SCALE_IDLE);
                }
                if (target) setStatus(target, "hovered", SCALE_HOVER);
                hoveredIdRef.current = target?.id ?? null;
                forceRender();
            }
        };

        const onUp = () => {
            const heldId = heldIdRef.current;
            if (!heldId) return;
            heldIdRef.current = null;
            setOverCancelZone(false);
            const held = bodiesRef.current.find((b) => b.id === heldId);
            if (!held) return;

            // Run already ended (e.g. time ran out mid-drag): drop the bubble with
            // NO match resolution — no mark, no removal, no win. finishLevel already
            // clears heldIdRef when it fires, so this mainly guards the race where a
            // release lands in the same tick the buzzer does.
            if (phaseRef.current !== "playing") {
                setStatus(held, "idle", SCALE_IDLE);
                const lateTargetId = hoveredIdRef.current;
                hoveredIdRef.current = null;
                if (lateTargetId) {
                    const lateTarget = bodiesRef.current.find((b) => b.id === lateTargetId);
                    if (lateTarget && lateTarget.status === "hovered") setStatus(lateTarget, "idle", SCALE_IDLE);
                }
                forceRender();
                return;
            }

            const targetId = hoveredIdRef.current;
            hoveredIdRef.current = null;
            const target = targetId ? bodiesRef.current.find((b) => b.id === targetId) ?? null : null;

            // Released over the cancel strip? Its top edge is the play-area wall, so
            // the held bubble straddles it when its center sits past bounds.height.
            // In the strip, a *wrong* match counts as a cancel (no mark, no shake) —
            // only a correct match still registers. (target?.pairId check below.)
            const inCancelZone = held.y + held.radius > boundsRef.current.height;
            const correct = !!target && held.pairId === target.pairId;

            if (target && (correct || !inCancelZone)) {
                // Autoplay: if the drop target is a Chinese word, narrate it on the
                // match regardless of whether the match is correct.
                if (target.kind === "word" && onSpeak) onSpeak(target.entry);

                if (correct) {
                    // Record a successful review for the matched pair's card,
                    // mirroring an flp "got it right" mark (both bubbles in a pair
                    // carry the same vocab entry, so either one identifies the card).
                    onMark?.(held.entry, true);
                    setStatus(held, "correct", SCALE_IDLE);
                    setStatus(target, "correct", SCALE_IDLE);
                    forceRender();
                    const to = setTimeout(() => {
                        // Remove both matched bubbles.
                        bodiesRef.current = bodiesRef.current.filter(
                            (b) => b.id !== held.id && b.id !== target.id
                        );
                        nodeMapRef.current.delete(held.id);
                        nodeMapRef.current.delete(target.id);
                        matchedRef.current += 1;
                        setMatched(matchedRef.current);
                        forceRender();
                        // Win when every pair is matched and nothing is left to launch.
                        if (bodiesRef.current.length === 0 && queueRef.current.length === 0) {
                            finishLevel("win");
                        }
                    }, POP_DURATION_MS);
                    pendingTimeoutsRef.current.push(to);
                } else {
                    // Record an incorrect review against the Chinese (word) bubble's
                    // card — mirrors an flp "got it wrong" mark. A registered match
                    // is always one word + one definition (same-kind drops never
                    // hover/match, see findHoverTarget), and held/target belong to
                    // different pairs here, so we mark whichever side is the Chinese
                    // word regardless of which bubble the player dragged.
                    const chineseBubble = held.kind === "word" ? held : target;
                    onMark?.(chineseBubble.entry, false);
                    setStatus(held, "wrong", held.targetScale);
                    setStatus(target, "wrong", target.targetScale);
                    forceRender();
                    const to = setTimeout(() => {
                        // Release both back to idle, settling in place (no throw).
                        if (bodiesRef.current.includes(held)) setStatus(held, "idle", SCALE_IDLE);
                        if (bodiesRef.current.includes(target)) setStatus(target, "idle", SCALE_IDLE);
                        forceRender();
                    }, WRONG_FEEDBACK_MS);
                    pendingTimeoutsRef.current.push(to);
                }
            } else {
                // No target, or a wrong match dropped in the cancel strip — just
                // settle back to idle (no mark). The physics wall clamp then lifts
                // the held bubble back out of the strip on the next frame.
                setStatus(held, "idle", SCALE_IDLE);
                // A wrong-in-zone drop still has a hovered target lit from onMove —
                // drop it back to idle too so it doesn't stay enlarged.
                if (target && target.status === "hovered") setStatus(target, "idle", SCALE_IDLE);
                forceRender();
            }
        };

        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
        return () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointercancel", onUp);
        };
    }, [findHoverTarget, forceRender, onSpeak, setStatus, finishLevel, writeTransform, onMark]);

    return (
        <Box
            ref={stageRef}
            className="bubble-stage"
            onPointerDown={onStageBackgroundPointerDown}
            onPointerMove={onStagePointerMove}
            sx={{
                position: "relative",
                flex: 1,
                minHeight: 0,
                width: "100%",
                overflow: "hidden",
                backgroundColor: COLORS.background,
                // Swallow touch gestures so dragging on the playfield never
                // scrolls/pans the page on mobile — the stage owns all touch input.
                touchAction: "none",
                overscrollBehavior: "contain",
            }}
        >
            {/* Danger glow — an inward-fading red vignette that pulses when the
                field is getting dangerously full (≥ DANGER_FILL_RATIO). It reaches
                deep into the playfield from every edge and fades toward the center
                (radial gradient: transparent core → red rim), so the alarm reads
                even when bubbles cover the borders. Sits above the bubbles but below
                the HUD; purely visual (pointerEvents off). When not in danger it
                fades out via the opacity transition and the pulse animation stops. */}
            <Box
                className="bubble-stage__danger-glow"
                sx={{
                    position: "absolute",
                    inset: 0,
                    pointerEvents: "none",
                    zIndex: 40,
                    // Vignette: clear well into the field, then ramp to a strong red
                    // at the very edges. The early transparent stop (28%) is what
                    // makes it extend "much deeper" than the old 4px border.
                    background:
                        "radial-gradient(125% 125% at 50% 50%, rgba(244,67,54,0) 28%, rgba(244,67,54,0.28) 62%, rgba(244,67,54,0.6) 100%)",
                    // Dismissed for good once the player has collapsed the game-over
                    // popup to inspect the (still-packed) field — the alarm is no
                    // longer meaningful, and it must not flash back if they re-expand.
                    opacity: danger && !dangerDismissed ? 1 : 0,
                    // Fade in/out when danger toggles; the pulse drives the in-danger feel.
                    transition: "opacity 0.35s ease",
                    animation: danger && !dangerDismissed ? "bubbleDangerPulse 1.15s ease-in-out infinite" : "none",
                    "@keyframes bubbleDangerPulse": {
                        "0%, 100%": { opacity: 0.45 },
                        "50%": { opacity: 1 },
                    },
                }}
            />

            {/* Descending ceiling — the visible "lid" that closes in from the top
                once the whole pool has launched. Its height is written every frame
                to match boundsRef.top (the play-area top wall); it sits below the
                HUD and bubbles so neither is occluded. Pure visual: the actual wall
                lives in the physics bounds. */}
            <Box
                ref={ceilingNodeRef}
                className="bubble-stage__ceiling"
                sx={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 0,
                    pointerEvents: "none",
                    zIndex: 2,
                    // Graphite slab fading to a hard, slightly menacing bottom edge
                    // so the closing wall reads clearly against the pale playfield.
                    background: "linear-gradient(180deg, #2a2f3a 0%, #3a414f 70%, #4a5263 100%)",
                    borderBottom: "3px solid #1c2029",
                    boxShadow: "0 6px 14px rgba(0,0,0,0.28)",
                }}
            />

            {/* HUD: level · pairs cleared */}
            <Box
                className="bubble-stage__hud"
                sx={{
                    position: "absolute",
                    top: 8,
                    left: 0,
                    right: 0,
                    display: "flex",
                    justifyContent: "space-between",
                    px: 1.5,
                    pointerEvents: "none",
                    zIndex: 50,
                }}
            >
                <Typography className="bubble-stage__level" sx={{ fontSize: SIZE.body, fontWeight: WEIGHT.bold, color: "#6b6b6b" }}>
                    Lv {levelNumber} · {levelLabel}
                </Typography>
                <Typography className="bubble-stage__progress" sx={{ fontSize: SIZE.body, fontWeight: WEIGHT.bold, color: "#6b6b6b" }}>
                    {matched}/{totalPairs}
                </Typography>
            </Box>

            {bodiesRef.current.map((body) => (
                <Bubble
                    key={body.id}
                    body={body}
                    status={body.status}
                    showPinyin={showPinyin}
                    showPinyinColor={showPinyinColor}
                    registerNode={registerNode}
                    onPointerDown={onPointerDown}
                    onPointerEnter={onBubbleEnter}
                    onPointerLeave={onBubbleLeave}
                    studyMode={studyMode}
                />
            ))}

            {/* Safe-release strip: drag a bubble here to abandon a match. Its top
                edge is the play-area bottom wall (see measure()), so settled bubbles
                never enter it — a bubble dragged in is clamped back out on release. */}
            <Box
                className="bubble-stage__cancel-zone"
                sx={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: 0,
                    height: `${CANCEL_ZONE_HEIGHT}px`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    // Drag is window-level; keep the strip from intercepting the
                    // stage-background pointerdown (used to clear study-mode reveal).
                    pointerEvents: "none",
                    // Below the HUD (50) and below bubbles, so a dragged bubble
                    // renders on top of the strip while it's over it.
                    zIndex: 5,
                    borderTop: "2px dashed",
                    borderColor: overCancelZone ? "rgba(244,67,54,0.85)" : "rgba(0,0,0,0.12)",
                    backgroundColor: overCancelZone ? "rgba(244,67,54,0.06)" : "rgba(0,0,0,0.02)",
                    transition: "background-color 0.15s ease, border-color 0.15s ease",
                }}
            >
                <Typography
                    className="bubble-stage__cancel-zone-label"
                    sx={{
                        fontSize: SIZE.body,
                        fontWeight: WEIGHT.bold,
                        color: overCancelZone ? "#F44336" : "#9a9a9a",
                        letterSpacing: 0.3,
                    }}
                >
                    drop here to cancel match
                </Typography>
            </Box>
        </Box>
    );
};

export default BubbleStage;
