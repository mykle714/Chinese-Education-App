import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Typography } from "@mui/material";
import { COLORS } from "../../theme/colors";
import { SIZE, WEIGHT } from "../../theme/scale";
import type { Language, VocabEntry } from "../../types";
import Bubble from "../bubbles/Bubble";
import { stepPhysics, planSpawn, fillRatio, type Bounds } from "../bubbles/physics";
import { makePair, launchBody } from "../bubbles/bodyFactory";
import type { BubbleBody, BubbleFill } from "../bubbles/types";
import {
    MAX_DT,
    CANCEL_ZONE_HEIGHT,
    SCALE_IDLE,
    SCALE_HELD,
    SCALE_HOVER,
    SCALE_LERP,
    DANGER_FILL_RATIO,
    LOSE_FILL_RATIO,
    POP_DURATION_MS,
    WRONG_FEEDBACK_MS,
    POST_DONE_SETTLE_MS,
} from "../bubbles/constants";
import { CATEGORY_COLORS } from "../../utils/categoryColors";
import { PAYOUT_BY_COLOR, RED_ONLY_FILL, rollColor } from "./spawnTable";
import { planSpawnBatch, type HydraBoardPair } from "./spawnPlanner";
import { OPENING_DEFINITION_BUBBLES, SCORE_PER_MATCH } from "./constants";
import type { HydraCard, HydraColor, HydraOutcome } from "./types";
import type { ColorBuffers } from "./useColorBuffers";

/**
 * Hydra Bubbles — the playfield (docs/HYDRA_BUBBLES.md).
 *
 * Its own stage rather than Bubble Match's, because almost none of Bubble Match's
 * field behavior applies: no launcher, no queue, no descending ceiling, no drift,
 * and a spawn planner Bubble Match has no concept of. What IS shared is the bubble
 * itself, the placement/separation math and the fill-ratio measure — all from
 * src/games/bubbles/.
 *
 * THE LOOP. Clear a pair → score +2 → the cleared bubble's COLOR buys 0–3 spawn
 * slots → the planner decides what fills them → the buffers supply cards of the
 * rolled colors. The board grows unless the player deliberately takes on their
 * hardest words. See § 3.
 *
 * Referenced by: HydraBubblesPage.tsx.
 */

/**
 * Bubble color by payout tier (§ 2) — the palette the decks page already teaches.
 *
 * TARGET IS THE ONE DEVIATION. App-wide, `CATEGORY_COLORS.Target` is #FF9E5A, which
 * is an ORANGE despite the app calling that band yellow everywhere else. On a decks
 * chip it passes; blown up to a bubble filling a chunk of the screen, next to a red
 * band that is genuinely red, it reads as a second orange rather than as the third
 * step of a red → yellow → green → blue ladder — and in Hydra that ladder is not
 * decoration, it is the payout the player is reading off the bubble (§ 2).
 *
 * #FFD166 is the canonical sibling of the hues already in the set (#EF476F /
 * #FFD166 / #06D6A0 is a standard palette, and Unfamiliar is exactly #EF476F while
 * Comfortable is #05C793), so this moves Target ONTO the family rather than off it.
 *
 * The divergence is deliberate and scoped to this file. If the app-wide Target band
 * is ever retuned to a true yellow, delete the literal below and go back to
 * CATEGORY_COLORS.Target — nothing else here needs to change.
 */
const HYDRA_TARGET_YELLOW = "#FFD166";

const FILL_BY_COLOR: Record<HydraColor, BubbleFill> = {
    Unfamiliar: { bg: "#FBD5DE", border: CATEGORY_COLORS.Unfamiliar },
    // Lighter bg than the other three: #FFD166 is a pale border, so it needs a paler
    // fill behind it or the ring stops reading as a distinct edge.
    Target: { bg: "#FFF4D6", border: HYDRA_TARGET_YELLOW },
    Comfortable: { bg: "#C6F2E4", border: CATEGORY_COLORS.Comfortable },
    Mastered: { bg: "#D5E1FA", border: CATEGORY_COLORS.Mastered },
};

/**
 * English bubbles are ALWAYS grey and carry no color information — the color
 * channel is reserved for payout (§ 2). This is also why Hydra's held cue is a ring
 * rather than Bubble Match's grey wash (§ 5.1).
 */
const DEFINITION_FILL: BubbleFill = { bg: "#ECECEF", border: "#C4C4CC" };

const fillForBody = (body: BubbleBody, color: HydraColor | undefined): BubbleFill =>
    body.kind === "definition" ? DEFINITION_FILL : FILL_BY_COLOR[color ?? "Unfamiliar"];

/** Both bubbles of one drawn card, whether or not they are currently on the field. */
interface HydraPair {
    pairId: string;
    card: HydraCard;
    word: BubbleBody;
    definition: BubbleBody;
    /**
     * Spawn rounds this card has spent as a stray, feeding the planner's aging
     * lottery (§ 4.2c). Counted HERE rather than in the planner because a "round" is a
     * spawn batch, and only the stage knows when one has happened — the planner is
     * pure and sees a single board snapshot.
     */
    strayRounds: number;
}

interface HydraStageProps {
    buffers: ColorBuffers;
    language: Language;
    showPinyin: boolean;
    showPinyinColor: boolean;
    /** Narrate a word bubble on pickup / match-onto. Undefined when autoplay is off. */
    onSpeak?: (entry: VocabEntry) => void;
    /** Bubbles cleared so far, lifted so the header and the end popup can show it. */
    onScore: (score: number) => void;
    /** A run-ending event. Hydra has no win — see HydraOutcome. */
    onGameOver: (outcome: HydraOutcome, score: number) => void;
    /** Record a recognition mark. Not called once the run is over. */
    onMark: (entry: VocabEntry, isCorrect: boolean) => void;
    /** Freeze the field while a modal covers it (§ 6.4). */
    paused: boolean;
    /** Fires the first time a lent card reaches the board, at most once per run. */
    onFirstLend?: () => void;
}

let pairSeq = 0;

const HydraStage: React.FC<HydraStageProps> = ({
    buffers,
    language,
    showPinyin,
    showPinyinColor,
    onSpeak,
    onScore,
    onGameOver,
    onMark,
    paused,
    onFirstLend,
}) => {
    const stageRef = useRef<HTMLDivElement>(null);
    const bodiesRef = useRef<BubbleBody[]>([]);
    const pairsRef = useRef<Map<string, HydraPair>>(new Map());
    const nodeMapRef = useRef<Map<string, HTMLDivElement>>(new Map());
    // The play area: the stage MINUS the bottom cancel strip (§ 7.1b), with a `top`
    // that never moves because Hydra has no descending ceiling. Kept as a Bounds so
    // the shared physics and planSpawn take it unchanged — which is also what keeps
    // the strip out of the fill ratio the spawn table and the loss both read.
    const boundsRef = useRef<Bounds>({ width: 0, top: 0, height: 0 });

    // Interaction.
    const heldIdRef = useRef<string | null>(null);
    const hoveredIdRef = useRef<string | null>(null);
    const grabOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
    const stageRectRef = useRef<DOMRect | null>(null);
    // FULL stage height, including the cancel strip. `boundsRef.height` stops at the
    // strip's top edge (that edge IS the play-area floor), so the drag needs the
    // untrimmed number to let a held bubble travel down into the strip.
    const fullHeightRef = useRef(0);
    // Purely cosmetic: tints the strip while a held bubble is over it. The release
    // path re-derives the same predicate from geometry rather than trusting this, so
    // a dropped pointer event can never make the strip lie about what a drop will do.
    const [overCancelZone, setOverCancelZone] = useState(false);
    const pausedRef = useRef(paused);
    pausedRef.current = paused;

    // Lifecycle.
    const phaseRef = useRef<"playing" | "done">("playing");
    const scoreRef = useRef(0);
    const pendingTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
    const rafRef = useRef(0);
    const loopRunningRef = useRef(false);
    const lastFrameRef = useRef(0);
    const doneSinceRef = useRef(0);
    const lendNoticedRef = useRef(false);

    const [, setTick] = useState(0);
    const forceRender = useCallback(() => setTick((t) => t + 1), []);
    const [danger, setDanger] = useState(false);
    const [squeeze, setSqueeze] = useState(false);
    const [score, setScore] = useState(0);

    const registerNode = useCallback((id: string, el: HTMLDivElement | null) => {
        if (el) nodeMapRef.current.set(id, el);
        else nodeMapRef.current.delete(id);
    }, []);

    const writeTransform = useCallback((b: BubbleBody) => {
        const node = nodeMapRef.current.get(b.id);
        if (!node) return;
        // The node is laid out at full size; the grow-in is a scale, so the translate
        // offset is by targetRadius (never the animating radius) to keep the visual
        // center pinned at (x, y).
        const grow = b.targetRadius > 0 ? b.radius / b.targetRadius : 1;
        node.style.transform =
            `translate(${b.x - b.targetRadius}px, ${b.y - b.targetRadius}px) scale(${grow * b.scale})`;
    }, []);

    // ---- Board queries ------------------------------------------------------
    const onField = useCallback(
        (body: BubbleBody) => bodiesRef.current.some((b) => b.id === body.id),
        []
    );

    /** The planner's view of the board — presence per card, plus the live fill. */
    const boardView = useCallback((): { fill: number; pairs: HydraBoardPair[] } => {
        const pairs: HydraBoardPair[] = [];
        for (const pair of pairsRef.current.values()) {
            const hasWord = onField(pair.word);
            const hasDefinition = onField(pair.definition);
            // A card with neither half on the board is finished; leaving it in the
            // view would let the planner "complete" a pair the player already cleared.
            if (!hasWord && !hasDefinition) continue;
            pairs.push({
                pairId: pair.pairId,
                color: pair.card.color,
                hasWord,
                hasDefinition,
                unmatchedRounds: pair.strayRounds,
            });
        }
        return { fill: fillRatio(bodiesRef.current, boundsRef.current), pairs };
    }, [onField]);

    // ---- Spawning -----------------------------------------------------------
    /** Place one body: pick a spot under the 20% rule, then let it grow in. */
    const place = useCallback((body: BubbleBody) => {
        const { x, y } = planSpawn(body.targetRadius, boundsRef.current, bodiesRef.current);
        launchBody(body, x, y);
        bodiesRef.current.push(body);
    }, []);

    /**
     * Draw a card of `color` and register both its bubbles. Returns null only when
     * the color could not be supplied even after waiting — the caller skips that slot
     * rather than stalling the run (§ 6.2b).
     *
     * ASYNC because `buffers.draw` waits out a dry buffer instead of substituting a
     * different color. A spawn batch therefore resolves over one network round trip
     * in the worst case; the bubbles simply arrive a beat later, which on a clockless
     * game costs the player nothing.
     */
    const drawPair = useCallback(async (color: HydraColor): Promise<HydraPair | null> => {
        const card = await buffers.draw(color);
        if (!card) return null;
        const pairId = `h${pairSeq++}`;
        const [word, definition] = makePair(pairId, card.entry);
        const pair: HydraPair = { pairId, card, word, definition, strayRounds: 0 };
        pairsRef.current.set(pairId, pair);
        // The first lent card to reach the board triggers the one-shot notice (§ 6.4).
        if (!lendNoticedRef.current && card.entry.starterPackBucket === "provisional") {
            lendNoticedRef.current = true;
            onFirstLend?.();
        }
        return pair;
    }, [buffers, onFirstLend]);

    /**
     * Execute a planned batch (§ 4). Actions are applied IN ORDER, and cards planned
     * earlier in the batch are resolved through `plannedToReal` so a later
     * `complete` can refer to one of them.
     */
    const runSpawnBatch = useCallback(async (payout: number) => {
        // AGE THE STRAYS FIRST (§ 4.2c). One spawn batch is one "round": every card
        // still showing a single half has waited another one, and any card that is a
        // live match is reset. The planner reads these counters to decide whether a
        // slot completes an old stray instead of introducing a new card, which is what
        // stops the board silting up with orphans the player can never act on.
        for (const pair of pairsRef.current.values()) {
            const hasWord = onField(pair.word);
            const hasDefinition = onField(pair.definition);
            if (!hasWord && !hasDefinition) continue; // finished card; about to be dropped
            pair.strayRounds = hasWord === hasDefinition ? 0 : pair.strayRounds + 1;
        }

        const actions = planSpawnBatch(boardView(), payout);
        const plannedToReal = new Map<string, string>();

        for (const action of actions) {
            // The batch AWAITS buffer refills, so the run can end (overflow loss in
            // the rAF loop, or a teardown for Play Again) between two slots. Placing
            // the remaining bubbles then drops them onto a board that is already
            // frozen and scored. Re-checked every slot rather than once up front,
            // because each `drawPair` below is another suspension point.
            if (phaseRef.current !== "playing") return;
            if (action.type === "complete") {
                const pairId = plannedToReal.get(action.pairId) ?? action.pairId;
                const pair = pairsRef.current.get(pairId);
                if (!pair) continue; // stale plan — the pair left the board; skip the slot
                const body = action.kind === "word" ? pair.word : pair.definition;
                if (!onField(body)) place(body);
                continue;
            }

            const pair = await drawPair(action.color);
            if (phaseRef.current !== "playing") return;
            if (!pair) continue; // color unsupplied even after waiting — skip the slot
            plannedToReal.set(action.plannedId, pair.pairId);
            if (action.type === "newPair") {
                place(pair.word);
                place(pair.definition);
            } else {
                place(action.kind === "word" ? pair.word : pair.definition);
            }
        }

        buffers.topUp();
        forceRender();
    }, [boardView, drawPair, place, onField, buffers, forceRender]);

    // ---- Run end ------------------------------------------------------------
    const finishRun = useCallback((outcome: HydraOutcome) => {
        if (phaseRef.current === "done") return;
        phaseRef.current = "done";
        // Force-drop anything still held so the field freezes clean and a late
        // pointerup cannot resolve a match after the run is over.
        const heldId = heldIdRef.current;
        if (heldId) {
            heldIdRef.current = null;
            const held = bodiesRef.current.find((b) => b.id === heldId);
            if (held) {
                held.status = "idle";
                held.targetScale = SCALE_IDLE;
            }
        }
        const hoveredId = hoveredIdRef.current;
        if (hoveredId) {
            const hov = bodiesRef.current.find((b) => b.id === hoveredId);
            if (hov && hov.status === "hovered") {
                hov.status = "idle";
                hov.targetScale = SCALE_IDLE;
            }
            hoveredIdRef.current = null;
        }
        forceRender();
        onGameOver(outcome, scoreRef.current);
    }, [onGameOver, forceRender]);

    // ---- rAF loop -----------------------------------------------------------
    const stepFrame = useCallback((now: number) => {
        if (pausedRef.current) {
            // Re-base the clock so the whole paused span does not arrive as one huge
            // dt on the first live frame.
            lastFrameRef.current = now;
            rafRef.current = requestAnimationFrame(stepFrame);
            return;
        }
        const dt = Math.min((now - lastFrameRef.current) / 1000, MAX_DT);
        lastFrameRef.current = now;
        const bodies = bodiesRef.current;
        const bounds = boundsRef.current;

        // No drift: Hydra's bubbles are placed and stay put (§ 1). Separation still
        // runs, so a growing bubble shoves its neighbors to make room.
        stepPhysics(bodies, dt, bounds, { drift: false });

        let anyAnimating = false;
        for (const b of bodies) {
            b.scale += (b.targetScale - b.scale) * SCALE_LERP;
            if (Math.abs(b.targetScale - b.scale) < 0.001) b.scale = b.targetScale;
            else anyAnimating = true;
            if (b.status === "growing") anyAnimating = true;
            writeTransform(b);
        }

        const ratio = fillRatio(bodies, bounds);
        if (phaseRef.current === "playing" && ratio >= LOSE_FILL_RATIO) {
            // OVERFLOW (§ 7.1). Hydra has no descending ceiling and no residual
            // safety net: the field only ever fills from spawns, and every spawn is
            // an event the player caused, so area alone is the honest signal.
            finishRun("overflow");
        }

        const isDanger = ratio >= DANGER_FILL_RATIO;
        setDanger((prev) => (prev === isDanger ? prev : isDanger));
        // The squeeze band (§ 3.1): from here the table rolls red only.
        const inSqueeze = ratio >= RED_ONLY_FILL;
        setSqueeze((prev) => (prev === inSqueeze ? prev : inSqueeze));

        // Post-run shutdown: stop writing transforms to every node once the field
        // goes static behind the end popup, with a grace cap for the over-packed
        // case that never fully settles.
        if (phaseRef.current === "done") {
            if (doneSinceRef.current === 0) doneSinceRef.current = now;
            if (!anyAnimating || now - doneSinceRef.current >= POST_DONE_SETTLE_MS) {
                loopRunningRef.current = false;
                return;
            }
        } else {
            doneSinceRef.current = 0;
        }

        rafRef.current = requestAnimationFrame(stepFrame);
    }, [writeTransform, finishRun]);

    const startLoop = useCallback(() => {
        if (loopRunningRef.current) return;
        loopRunningRef.current = true;
        lastFrameRef.current = performance.now();
        doneSinceRef.current = 0;
        rafRef.current = requestAnimationFrame(stepFrame);
    }, [stepFrame]);

    // ---- Setup --------------------------------------------------------------
    useEffect(() => {
        phaseRef.current = "playing";
        scoreRef.current = 0;
        setScore(0);
        setDanger(false);
        setSqueeze(false);
        bodiesRef.current = [];
        pairsRef.current.clear();
        nodeMapRef.current.clear();
        heldIdRef.current = null;
        hoveredIdRef.current = null;
        lendNoticedRef.current = false;

        const measure = () => {
            const rect = stageRef.current?.getBoundingClientRect();
            if (!rect) return;
            fullHeightRef.current = rect.height;
            // The play area EXCLUDES the bottom cancel strip, exactly as Bubble Match
            // does. One measurement drives three things at once: nothing spawns into
            // the strip (planSpawn), settled bubbles are walled out of it (physics),
            // and the strip is not counted as playable area by the fill ratio — so
            // the overflow loss and the spawn table still read the same number (§ 3.1).
            boundsRef.current = {
                width: rect.width,
                top: 0,
                height: rect.height - CANCEL_ZONE_HEIGHT,
            };
        };
        measure();
        window.addEventListener("resize", measure);

        // THE OPENING BOARD (§ 1): one live pair plus one English stray — 1 Chinese +
        // 2 English. The stray is English because the ratio rule carries the odd
        // bubble as English (§ 4.2), so the opening board is already balanced.
        //
        // COLORS COME FROM THE TABLE, NOT FROM HERE (2026-08-18). Both slots roll
        // `rollColor(0)` — an empty board, which is the fill the opening board has by
        // definition. They used to be hard-coded blue + green, which made the opening
        // a second, silent source of truth for an economy the table already owns: a
        // retune of the fill-0 row would have left the opening untouched. The fill-0
        // row is now blue-only, so this still opens on a blue pair — but because the
        // table says so.
        //
        // CANCELLED ON CLEANUP, and this is load-bearing. Seeding became ASYNC when
        // `draw` started waiting out a dry buffer, which opened a window this effect
        // never had before: the effect can be torn down and re-run while a seed is
        // still awaiting its first card. React's StrictMode double-invokes mount
        // effects, so in dev that happens on EVERY entry — run 1 awaits, cleanup
        // fires, run 2 resets `bodiesRef` and seeds again, then run 1's await
        // resolves and places its bubbles into the fresh board. The board opened with
        // exactly double the bubbles (2 Chinese + 4 English).
        //
        // It is not a dev-only concern: the stage is remounted on `runId` for Play
        // Again, so a slow seed from the previous run could bleed into the next one.
        // The flag is closed over by this effect's own closure, so each run cancels
        // only itself.
        let cancelled = false;
        const seedOpening = async () => {
            // Checked before each draw as well as after, so a cancelled seed stops
            // consuming buffer stock rather than just declining to place it.
            if (cancelled) return;
            const first = await drawPair(rollColor(0));
            if (cancelled) return;
            if (first) {
                place(first.word);
                place(first.definition);
            }
            for (let i = 1; i < OPENING_DEFINITION_BUBBLES; i++) {
                if (cancelled) return;
                const stray = await drawPair(rollColor(0));
                if (cancelled) return;
                if (stray) place(stray.definition);
            }
            buffers.topUp();
            forceRender();
        };
        void seedOpening();
        startLoop();

        return () => {
            cancelled = true;
            window.removeEventListener("resize", measure);
            cancelAnimationFrame(rafRef.current);
            loopRunningRef.current = false;
            pendingTimeoutsRef.current.forEach(clearTimeout);
            pendingTimeoutsRef.current = [];
        };
        // Mount-only: the stage is remounted (keyed on runId) for a fresh run.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ---- Drag → hover → match ----------------------------------------------
    // Only an opposite-kind bubble can ever pair, so a same-kind bubble is not a
    // hover target and dropping onto it is a no-op rather than a fatal wrong match.
    const findHoverTarget = useCallback((held: BubbleBody): BubbleBody | null => {
        let best: BubbleBody | null = null;
        let bestDist = Infinity;
        for (const b of bodiesRef.current) {
            if (b.id === held.id) continue;
            if (b.kind === held.kind) continue;
            if (b.status === "correct" || b.status === "wrong" || b.status === "growing") continue;
            const d = Math.hypot(b.x - held.x, b.y - held.y);
            if (d < held.radius + b.radius && d < bestDist) {
                best = b;
                bestDist = d;
            }
        }
        return best;
    }, []);

    const setStatus = useCallback((body: BubbleBody, status: BubbleBody["status"], targetScale: number) => {
        body.status = status;
        body.targetScale = targetScale;
    }, []);

    const colorOf = useCallback(
        (pairId: string): HydraColor | undefined => pairsRef.current.get(pairId)?.card.color,
        []
    );

    const onPointerDown = useCallback((id: string, e: React.PointerEvent) => {
        if (phaseRef.current !== "playing" || pausedRef.current) return;
        const body = bodiesRef.current.find((b) => b.id === id);
        if (!body || body.status === "correct" || body.status === "wrong") return;

        const rect = stageRef.current?.getBoundingClientRect();
        if (!rect) return;
        stageRectRef.current = rect;

        // Grabbing a still-growing bubble finishes its grow-in instantly, so it is
        // dragged and matched as a normal, complete bubble.
        if (body.status === "growing") body.radius = body.targetRadius;

        heldIdRef.current = id;
        grabOffsetRef.current = {
            x: e.clientX - rect.left - body.x,
            y: e.clientY - rect.top - body.y,
        };
        setStatus(body, "held", SCALE_HELD);
        forceRender();

        if (body.kind === "word" && onSpeak) onSpeak(body.entry);
    }, [forceRender, onSpeak, setStatus]);

    useEffect(() => {
        const onMove = (e: PointerEvent) => {
            const heldId = heldIdRef.current;
            if (!heldId) return;
            const held = bodiesRef.current.find((b) => b.id === heldId);
            const rect = stageRectRef.current;
            if (!held || !rect) return;

            const bounds = boundsRef.current;
            const px = e.clientX - rect.left - grabOffsetRef.current.x;
            const py = e.clientY - rect.top - grabOffsetRef.current.y;
            // X and the top stay on the play bounds, but the BOTTOM is unclamped past
            // the stage edge so even a large bubble fits entirely inside the (shorter)
            // cancel strip. Only the held bubble is exempt; settled bodies are still
            // walled out at `bounds.height` by the physics step.
            const maxY = fullHeightRef.current + held.radius;
            held.x = Math.max(held.radius, Math.min(bounds.width - held.radius, px));
            held.y = Math.max(held.radius, Math.min(maxY, py));

            // Tint the strip while the held bubble overlaps it (feedback only — the
            // decision is re-derived on release from the same predicate).
            const inZone = held.y + held.radius > bounds.height;
            setOverCancelZone((prev) => (prev === inZone ? prev : inZone));

            // Written now rather than next frame so the drag tracks the pointer with
            // no added latency.
            held.scale += (held.targetScale - held.scale) * SCALE_LERP;
            writeTransform(held);

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
            const held = bodiesRef.current.find((b) => b.id === heldId);
            if (!held) return;

            const targetId = hoveredIdRef.current;
            hoveredIdRef.current = null;
            const target = targetId
                ? bodiesRef.current.find((b) => b.id === targetId) ?? null
                : null;

            // A release that lands after the buzzer resolves nothing.
            if (phaseRef.current !== "playing") {
                setStatus(held, "idle", SCALE_IDLE);
                if (target && target.status === "hovered") setStatus(target, "idle", SCALE_IDLE);
                forceRender();
                return;
            }

            // Dropped on empty space — not a wrong match, just a drop. Only a drop
            // ONTO a bubble is a judgement (§ 7.1).
            if (!target) {
                setStatus(held, "idle", SCALE_IDLE);
                setOverCancelZone(false);
                forceRender();
                return;
            }

            // THE CANCEL STRIP (§ 7.1b). Its top edge is the play-area floor, so the
            // held bubble straddles it exactly when its lower edge passes
            // `bounds.height`. A drop in the strip abandons the match: no mark, no
            // shake, no run end. A CORRECT match still counts, so the strip can never
            // cost the player a match they had actually earned.
            const inCancelZone = held.y + held.radius > boundsRef.current.height;
            const correct = held.pairId === target.pairId;

            if (inCancelZone && !correct) {
                setStatus(held, "idle", SCALE_IDLE);
                // The target was lit by onMove while the drag passed over it; put it
                // back or it stays enlarged on a board that never resolved anything.
                if (target.status === "hovered") setStatus(target, "idle", SCALE_IDLE);
                setOverCancelZone(false);
                forceRender();
                return;
            }

            if (target.kind === "word" && onSpeak) onSpeak(target.entry);
            setOverCancelZone(false);

            if (!correct) {
                // ONE WRONG MATCH ENDS THE RUN — immediate, no confirmation (§ 7.1).
                // The negative mark goes on the CHINESE bubble's card, matching Bubble
                // Match: a registered match is always one word + one definition, and
                // the recognition track belongs to the foreign side.
                const chinese = held.kind === "word" ? held : target;
                onMark(chinese.entry, false);
                setStatus(held, "wrong", held.targetScale);
                setStatus(target, "wrong", target.targetScale);
                forceRender();
                // Let the shake play before the popup lands, so the player sees WHAT
                // went wrong rather than a score card appearing out of nowhere.
                const to = setTimeout(() => finishRun("wrongMatch"), WRONG_FEEDBACK_MS);
                pendingTimeoutsRef.current.push(to);
                return;
            }

            // Correct: score, mark, pop, then pay out the cleared color's spawns.
            onMark(held.entry, true);
            scoreRef.current += SCORE_PER_MATCH;
            setScore(scoreRef.current);
            onScore(scoreRef.current);
            setStatus(held, "correct", SCALE_IDLE);
            setStatus(target, "correct", SCALE_IDLE);
            forceRender();

            const clearedColor = colorOf(held.pairId) ?? "Unfamiliar";
            const to = setTimeout(() => {
                bodiesRef.current = bodiesRef.current.filter(
                    (b) => b.id !== held.id && b.id !== target.id
                );
                nodeMapRef.current.delete(held.id);
                nodeMapRef.current.delete(target.id);
                // The card is spent for this run: retired from the buffers so it is
                // not immediately re-served as its own replacement.
                buffers.release(held.entry.id);
                pairsRef.current.delete(held.pairId);
                // THE PAYOUT (§ 2). Planned against the board as it stands AFTER the
                // pair is removed, which is what makes the fill-keyed table read the
                // number the player is actually looking at.
                if (phaseRef.current === "playing") {
                    // Fire-and-forget: the batch awaits buffer refills, and the
                    // match animation must not block on the network.
                    void runSpawnBatch(PAYOUT_BY_COLOR[clearedColor]);
                }
                forceRender();
            }, POP_DURATION_MS);
            pendingTimeoutsRef.current.push(to);
        };

        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
        return () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointercancel", onUp);
        };
    }, [findHoverTarget, forceRender, onSpeak, setStatus, writeTransform, onMark, onScore, finishRun, runSpawnBatch, colorOf, buffers]);

    return (
        <Box
            ref={stageRef}
            className="hydra-stage"
            sx={{
                position: "relative",
                flex: 1,
                minHeight: 0,
                width: "100%",
                overflow: "hidden",
                backgroundColor: COLORS.background,
                // The stage owns all touch input; dragging must never scroll the page.
                touchAction: "none",
                overscrollBehavior: "contain",
            }}
        >
            {/* Danger vignette — same warning band as Bubble Match (0.72 → 0.94). */}
            <Box
                className="hydra-stage__danger-glow"
                sx={{
                    position: "absolute",
                    inset: 0,
                    pointerEvents: "none",
                    zIndex: 40,
                    background:
                        "radial-gradient(125% 125% at 50% 50%, rgba(244,67,54,0) 18%, rgba(244,67,54,0.45) 48%, rgba(229,57,53,0.78) 76%, rgba(198,40,40,0.95) 100%)",
                    opacity: danger ? 1 : 0,
                    transition: "opacity 0.35s ease",
                    animation: danger ? "hydraDangerPulse 0.9s ease-in-out infinite" : "none",
                    "@keyframes hydraDangerPulse": {
                        "0%, 100%": { opacity: 0.7 },
                        "50%": { opacity: 1 },
                    },
                }}
            />

            {/* HUD: score, and the squeeze warning once the table goes red-only. */}
            <Box
                className="hydra-stage__hud"
                sx={{
                    position: "absolute",
                    top: 8,
                    left: 0,
                    right: 0,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    px: 1.5,
                    pointerEvents: "none",
                    zIndex: 50,
                }}
            >
                <Typography
                    className="hydra-stage__score"
                    sx={{ fontSize: SIZE.body, fontWeight: WEIGHT.bold, color: "#6b6b6b" }}
                >
                    {score} cleared
                </Typography>
                {squeeze && (
                    <Typography
                        className="hydra-stage__squeeze"
                        sx={{ fontSize: SIZE.body, fontWeight: WEIGHT.bold, color: CATEGORY_COLORS.Unfamiliar }}
                    >
                        red only
                    </Typography>
                )}
            </Box>

            {bodiesRef.current.map((body) => (
                <Bubble
                    key={body.id}
                    body={body}
                    status={body.status}
                    fill={fillForBody(body, colorOf(body.pairId))}
                    // Grey means "English" here, so the pickup cue is a ring (§ 5.1).
                    heldCue="ring"
                    showPinyin={showPinyin && language === "zh"}
                    showPinyinColor={showPinyinColor}
                    registerNode={registerNode}
                    onPointerDown={onPointerDown}
                />
            ))}

            {/* SAFE-RELEASE STRIP (§ 7.1b). Its top edge is the play-area floor (see
                measure()), so settled bubbles never enter it and a bubble dragged in
                is walled back out on release. Hydra needs this more than Bubble Match
                does: one wrong match ends the run outright, and on a board near the
                0.94 loss line there may be no empty space left to drop onto — every
                release would land on some bubble. Without the strip a crowded board
                makes backing out of a drag impossible. */}
            <Box
                className="hydra-stage__cancel-zone"
                sx={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: 0,
                    height: `${CANCEL_ZONE_HEIGHT}px`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    // The drag is tracked on window listeners; the strip must not
                    // intercept pointer events aimed at the stage or its bubbles.
                    pointerEvents: "none",
                    // Under the HUD (50) and under the bubbles, so a held bubble
                    // renders ON TOP of the strip while hovering it.
                    zIndex: 5,
                    borderTop: "2px dashed",
                    borderColor: overCancelZone ? "rgba(244,67,54,0.85)" : "rgba(0,0,0,0.12)",
                    backgroundColor: overCancelZone ? "rgba(244,67,54,0.06)" : "rgba(0,0,0,0.02)",
                    transition: "background-color 0.15s ease, border-color 0.15s ease",
                }}
            >
                <Typography
                    className="hydra-stage__cancel-zone-label"
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

export default HydraStage;
