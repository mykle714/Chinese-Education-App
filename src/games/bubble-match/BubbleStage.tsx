import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Typography } from "@mui/material";
import { SIZE, WEIGHT } from "../../theme/scale";
import type { VocabEntry } from "../../pages/FlashcardsLearnPage/types";
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
} from "./constants";

export type LoseReason = "time" | "full";

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
    onLevelLose: (reason: LoseReason) => void;
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
 * countdown, and all drag/match interaction. Reports up via onLevelWin /
 * onLevelLose; the page handles progression and re-mounts the stage per level
 * (keyed on level number) so each level starts from a clean slate.
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

    // Physics + interaction source of truth (mutated in place; never per-frame state).
    const bodiesRef = useRef<BubbleBody[]>([]);
    const queueRef = useRef<BubbleBody[]>([]);
    const nodeMapRef = useRef<Map<string, HTMLDivElement>>(new Map());
    // Play bounds: width + walls, with height EXCLUDING the bottom cancel strip
    // (height = stage height − CANCEL_ZONE_HEIGHT). Everything physics cares about
    // (spawn inset, wall clamp, fill ratio) reads this, so the strip is outside play.
    const boundsRef = useRef<Bounds>({ width: 0, height: 0 });
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
    const [timeLeft, setTimeLeft] = useState(config.durationSec);
    const [danger, setDanger] = useState(false);
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
        (outcome: "win" | LoseReason) => {
            if (phaseRef.current === "done") return;
            phaseRef.current = "done";
            if (outcome === "win") onLevelWin();
            else onLevelLose(outcome);
        },
        [onLevelWin, onLevelLose]
    );

    // ---- Main setup: build queue, start loops. Re-runs per level. -----------
    useEffect(() => {
        phaseRef.current = "playing";
        matchedRef.current = 0;
        setMatched(0);
        setTimeLeft(config.durationSec);
        setDanger(false);
        bodiesRef.current = [];
        nodeMapRef.current.clear();
        heldIdRef.current = null;
        hoveredIdRef.current = null;
        overfillSinceRef.current = null;
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
                boundsRef.current = { width: rect.width, height: rect.height - CANCEL_ZONE_HEIGHT };
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

        // Spawn the first immediately, then on the level's cadence.
        spawnOne();
        const launchTimer = setInterval(spawnOne, config.launchIntervalMs);

        // Countdown — lose if time runs out with anything left to match.
        const secondTimer = setInterval(() => {
            if (phaseRef.current !== "playing") return;
            setTimeLeft((t) => {
                const next = t - 1;
                if (next <= 0) {
                    finishLevel("time");
                    return 0;
                }
                return next;
            });
        }, 1000);

        // rAF physics + transform-write loop.
        let raf = 0;
        let last = performance.now();
        const frame = (now: number) => {
            const dt = Math.min((now - last) / 1000, MAX_DT);
            last = now;
            const bodies = bodiesRef.current;
            const bounds = boundsRef.current;

            const residual = stepPhysics(bodies, dt, bounds);

            // Smoothly approach each bubble's target scale and write transforms.
            for (const b of bodies) {
                b.scale += (b.targetScale - b.scale) * SCALE_LERP;
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
                    finishLevel("full");
                }
            }

            // Danger glow when the field is getting full (warning, below the loss line).
            const isDanger = ratio >= DANGER_FILL_RATIO;
            setDanger((prev) => (prev === isDanger ? prev : isDanger));

            raf = requestAnimationFrame(frame);
        };
        raf = requestAnimationFrame(frame);

        return () => {
            window.removeEventListener("resize", measure);
            clearInterval(launchTimer);
            clearInterval(secondTimer);
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
                    // Record an incorrect review for the card the player was
                    // dragging (the held bubble) — mirrors an flp "got it wrong"
                    // mark. The drop target belongs to a different pair, so only
                    // the held bubble's card is the one the player answered.
                    onMark?.(held.entry, false);
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
                backgroundColor: "#FAFAFB",
                // Swallow touch gestures so dragging on the playfield never
                // scrolls/pans the page on mobile — the stage owns all touch input.
                touchAction: "none",
                overscrollBehavior: "contain",
                // Red danger glow when the field is ≥85% full.
                boxShadow: danger ? "inset 0 0 0 4px rgba(244,67,54,0.85)" : "inset 0 0 0 0 transparent",
                transition: "box-shadow 0.25s ease",
            }}
        >
            {/* HUD: level · countdown · pairs cleared */}
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
                <Typography
                    className="bubble-stage__timer"
                    sx={{
                        fontSize: SIZE.bodyLg,
                        fontWeight: 800,
                        // Red in the final-5s warning.
                        color: timeLeft <= 5 ? "#F44336" : "#3a3a3a",
                    }}
                >
                    {timeLeft}s
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
