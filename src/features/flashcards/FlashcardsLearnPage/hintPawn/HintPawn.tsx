import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Box, useMediaQuery } from "@mui/material";
import { keyframes } from "@mui/material/styles";
import { IsoPawn, IsoPlatform, IsoScene, fallFromHeight, makeProjector, type PawnEntranceCue, type PawnStretchCue, type PawnTapReaction, type WorldRect } from "../../../deckTower/iso";
import { TOWER_WORLDS } from "../../../deckTower/towerWorlds";
import HintBubbleSurface, { HINT_BUBBLE_TAIL_SIZE } from "../../../../components/hintBubble/HintBubbleSurface";
import { HINT_MOTION } from "../../../../components/hintBubble/hintMotion";
import { useHintBubblePresence, type PresenceItem } from "../../../../components/hintBubble/useHintBubblePresence";
import { SAFE_BOTTOM } from "../../../../theme/safeArea";
import type { FlpWorld } from "../../../../../server/contracts/studyMode";
import { dismissHintPawn, takeHintLineIndex, useHintPawnDismissed } from "./hintPawnVisit";
import PawnHintBody from "./PawnHintBody";
import PawnBubbleTail from "./PawnBubbleTail";
import { HEAD_CENTRE, HEAD_RADIUS } from "../../../deckTower/iso/pawnFigure";
import { useHintPawnIdles } from "./useHintPawnIdles";
import { usePawnOuch } from "./usePawnOuch";
import PawnOuchBubble from "./PawnOuchBubble";
import { useSpaceBelowCard } from "./useSpaceBelowCard";
import type { PawnHint } from "./pawnHints";
import { useDayClock } from "../../../../timeOfDay/useDayClock";
import { phaseShare } from "../../../../timeOfDay/dayPhase";
import { useTestingFeatures } from "../../../../hooks/useTestingFeatures";
import { useSoftIntro } from "../../../../softIntro/useSoftIntro";

/**
 * HintPawn — the flp's study helper: a tiny (still, not bobbing) platform in the world's colour, in
 * the screen's bottom-left corner, with a pawn on it that speaks the card's hint in a
 * speech bubble (docs/HINT_PAWN.md).
 *
 * ── Arrival ──────────────────────────────────────────────────────────────────
 * Nothing is drawn until the FIRST hint of a session is due on a card the learner can see.
 * Then the platform rises in from below the screen (RISE_MS), the pawn drops onto it from
 * the top of the screen (hintPawnDrop, starting as the rise settles) and the bubble grows
 * out beside it once it has landed. After that the pawn STAYS for the rest of the session: cards
 * with no hint just pop the bubble, and the next hint grows a new one with the next line.
 * Parking the session (the visit ends, `parked`) sends it home, so the next dive starts
 * fresh and replays the arrival on its first hint.
 *
 * ── Back stretch ─────────────────────────────────────────────────────────────
 * Every new line of dialogue — each bubble that grows in, the arrival's first one included —
 * cues the pawn's back stretch (IsoPawn `stretch`, usePawnMotion's STRETCH), timed to start
 * as the bubble starts growing (its `visibleAt`), so the pawn draws itself up as it speaks.
 *
 * ── Idle animations ──────────────────────────────────────────────────────────
 * Once a minute without a tap on the pawn it does something: a stretch, a sneeze, a song,
 * dozing off or knitting (useHintPawnIdles). Dozing and knitting are states it stays in
 * until it is tapped or has a new line to say.
 *
 * ── Tap reactions ────────────────────────────────────────────────────────────
 * A tap on the pawn (IsoPawn `tappable` + `onTap`) is answered one of two ways: 4 in 5 a
 * flinch and a short "ouch" line in its own bubble up and to the right of its head, over
 * the card (PawnOuchBubble, usePawnOuch); 1 in 5 (PAWN_TAP_JUMP_SHARE) the tower's jump. A
 * tap while it is still in the air always jumps again — chained jumps climb. No "!" here: the ouch replaces it.
 *
 * ── Dismissing ───────────────────────────────────────────────────────────────
 * A swipe LEFT on the platform or the pawn throws the platform off the screen's left edge
 * (LEAVE_MS) and then marks the pawn dismissed for the rest of the Deck Tower visit, in
 * every world (hintPawnVisit.ts). A shorter drag springs back. A tap on the BUBBLE closes
 * only that hint's bubble (`closedKey`), uncovering the More Info pill; the pawn stays and
 * the next card's hint grows a new one.
 *
 * ── Hit area + the bubble ────────────────────────────────────────────────────
 * The stage overlaps the card's bottom-left corner (the pawn's head), so it is
 * `pointer-events: none` except for the platform's own hit box and the pawn's tap target —
 * a swipe on the card corner still reaches the card. The bubble is a sibling of the stage:
 * it sits in the space below the card (from beside the stage to the right gutter), capped
 * to that space (useSpaceBelowCard) so it never overlaps the card, its tail pointing LEFT
 * at the pawn, over the More Info pill (z-index 3). The whole bubble is one tap target
 * (tap to dismiss), cued by a three-line "Tap / to / dismiss" in its bottom-right corner —
 * a soft introduction (`pawnDismissCue`, DismissCueSoftIntro below): after 49 arrivals over
 * 14 days the cue is dropped and takes no space. Drawn by PawnHintBody — beside the line (text variant) or beside the cpcd words, never
 * under the one-line line (cpcd variant; pawnHints.ts → `PAWN_BUBBLE_VARIANT`).
 *
 * ── Geometry ─────────────────────────────────────────────────────────────────
 * A fixed dimetric scene (makeProjector(UNIT)), in the world's UNWASHED colours: the study
 * camera fades the time-of-day wash out on the dive (docs/DECK_TOWER.md § Time of day →
 * "The wash"), so the session is always seen in day colours. The platform has no ground
 * shadow (IsoPlatform `ground` omitted) — it floats over DOM, not over a sky plane — and
 * no light rim band (its rim takes the floor tone); the pawn casts no shadow. The
 * stage sits on the More Info pill's baseline (the same `24px + SAFE_BOTTOM` offset), in
 * the free space left of it.
 *
 * Layer: flp page presentation (client). Rendered by FlashcardsLearnPage over ContentArea.
 *
 * Depends on: the iso framework (src/features/deckTower/iso — IsoScene, IsoPlatform,
 * IsoPawn, fallFromHeight), towerWorlds.ts (TOWER_WORLDS), the shared hint bubble
 * (src/components/hintBubble), hintPawnVisit.ts, pawnHints.ts, PawnHintBody.tsx,
 * useHintPawnIdles.ts, usePawnOuch.ts + PawnOuchBubble.tsx, and the
 * shared day clock (src/timeOfDay/useDayClock.ts) for the night vest.
 */

interface HintPawnProps {
    /** The session's world — picks the platform's colour. */
    world: FlpWorld;
    /** What the pawn has to say about the front card, or null (pawnHints.ts → `pawnHintFor`). */
    hint: PawnHint | null;
    /**
     * The card is not on screen (count card over it, a game break, the icon editor):
     * everything is hidden at once, without leaving, and no arrival starts.
     */
    unseen: boolean;
    /** The session is parked under the tower: the pawn goes home and arrives fresh next dive. */
    parked: boolean;
    /** ContentArea — the box the stage and bubble are positioned in. */
    contentRef: React.RefObject<HTMLElement | null>;
    /** The card's frame: the bubble is clipped to the space below it (useSpaceBelowCard). */
    cardFrameRef: React.RefObject<HTMLElement | null>;
}

// ── Scene ────────────────────────────────────────────────────────────────────

/**
 * Screen px per world unit (the fixed dimetric projector's `unit`). Was 13; tripled
 * 2026-11-08 (owner: "3 times as big") — the pawn's size follows the unit.
 */
const UNIT = 39;
/**
 * The tiny platform, kept at its original on-screen size when the pawn was tripled
 * (owner, 2026-11-08): the old 2.6-unit slab, 0.7 thick, at unit 13 — i.e. a third of
 * that at unit 39. About 76 px wide; the bigger pawn stands on it. Its floor is z = 0.
 */
const PLATFORM_SCALE = 13 / UNIT;
const PLATFORM: WorldRect = { x: 0, y: 0, w: 2.6 * PLATFORM_SCALE, d: 2.6 * PLATFORM_SCALE, r: 0.35 * PLATFORM_SCALE };
const PLATFORM_THICKNESS = 0.7 * PLATFORM_SCALE;
/** The pawn stands in the middle of the floor. */
const PAWN_AT = { x: PLATFORM.w / 2, y: PLATFORM.d / 2 };
/** A little over the pawn's height (body 1.5 + head), for the scene's top edge. */
const PAWN_TOP_Z = 2.3;
const PROJ = makeProjector(UNIT);
/**
 * The pawn faces this many degrees off the viewer, toward screen-right — toward the speech
 * bubble, so it reads as turned to its own line (owner, 2026-11-08). Drives IsoPawn
 * `facing`: the night vest turns with it (its open front shows just right of centre —
 * docs/HINT_PAWN.md § "Night vest") and the back stretch curls away from it
 * (§ "Back stretch").
 */
const PAWN_FACING_DEG = 15;

/**
 * The scene's px box, from the projected extremes: the left / right corners of the slab,
 * the top of the pawn's head, and the front corner's underside. Padded for the rim line.
 */
const SCENE_BOX = (() => {
    const pad = 4;
    const left = PROJ.project(PLATFORM.x, PLATFORM.y + PLATFORM.d, 0).x;
    const right = PROJ.project(PLATFORM.x + PLATFORM.w, PLATFORM.y, 0).x;
    const top = PROJ.project(PAWN_AT.x, PAWN_AT.y, PAWN_TOP_Z).y;
    const bottom = PROJ.project(PLATFORM.x + PLATFORM.w, PLATFORM.y + PLATFORM.d, -PLATFORM_THICKNESS).y;
    const pawn = PROJ.project(PAWN_AT.x, PAWN_AT.y, 0);
    const floorBack = PROJ.project(PLATFORM.x, PLATFORM.y, 0).y;
    return {
        viewBox: `${left - pad} ${top - pad} ${right - left + 2 * pad} ${bottom - top + 2 * pad}`,
        width: right - left + 2 * pad,
        height: bottom - top + 2 * pad,
        /** The pawn's feet, in stage px (the bubble's tail lines up over it). */
        pawnX: pawn.x - (left - pad),
        pawnY: pawn.y - (top - pad),
        /** Where the floor's back corner is, in stage px — the platform's hit box starts here. */
        floorTop: floorBack - (top - pad),
    };
})();

// ── Layout + motion ──────────────────────────────────────────────────────────

/** The stage's distance from ContentArea's left edge, px. */
const GUTTER = 10;
/**
 * The stage's bottom sits this far below the More Info pill's bottom (`24px + SAFE_BOTTOM`),
 * px. Was 6 (the slab's underside level with the pill); 20 since 2026-11-08 (owner: "sit
 * lower on the screen") — the slab now rests 4 px above the safe area's bottom.
 */
const BASELINE_DROP = 20;
/** The bubble's bottom edge, px above ContentArea's bottom (plus SAFE_BOTTOM) — below the pill's, so it covers it. */
const BUBBLE_BOTTOM = 10;
/** Gap between the stage's right edge and the bubble's tail tip, px. */
const BUBBLE_GAP = 4;
/** Clearance kept between the bubble's top and the card's bottom edge, px. */
const BUBBLE_CARD_CLEARANCE = 6;
/** The bubble's left edge, px right of the stage's left edge. */
const BUBBLE_LEFT_IN_STAGE = SCENE_BOX.width + BUBBLE_GAP + HINT_BUBBLE_TAIL_SIZE / 2;
/**
 * Where the bubble's tail points: the pawn's HEAD centre (owner, 2026-11-08), in px from
 * the bubble body's bottom-left corner (y up). x: the pawn's x in the stage, less the
 * bubble's left. y: the stage sits BASELINE_DROP lower than the pill and the bubble
 * BUBBLE_BOTTOM up; the feet are `height − pawnY` up the stage, the head HEAD_CENTRE units
 * over them. Ignores the levitation bob (a few px).
 */
const PAWN_HEAD_FROM_BUBBLE = {
    x: SCENE_BOX.pawnX - BUBBLE_LEFT_IN_STAGE,
    y: 24 - BASELINE_DROP - BUBBLE_BOTTOM + (SCENE_BOX.height - SCENE_BOX.pawnY) + HEAD_CENTRE * PROJ.heightUnit,
};
/**
 * The "ouch" bubble's tail tip (usePawnOuch, PawnOuchBubble): just off the head's outline,
 * up and to its right, in stage px (y down from the stage's top). The head's screen radius
 * is its camera-facing radius at the fixed view's facing scale.
 */
const HEAD_SCREEN_R = HEAD_RADIUS * PROJ.facingScaleAt(0, 0, 0);
const OUCH_TIP = {
    x: SCENE_BOX.pawnX + HEAD_SCREEN_R * 0.85,
    y: SCENE_BOX.pawnY - HEAD_CENTRE * PROJ.heightUnit - HEAD_SCREEN_R * 0.85,
};
/** The share of ground taps the pawn answers with a jump; the rest get a flinch + "ouch" (owner, 2026-11-08: 1 in 5). */
const PAWN_TAP_JUMP_SHARE = 0.2;
/** The rise in from below the screen. */
const RISE_MS = 520;
/** From the stage's rest to below the screen's bottom edge, px (the pill's offset + the stage + margin). */
const RISE_FROM_PX = SCENE_BOX.height + 60;
/** The throw off the left edge on a dismissing swipe. */
const LEAVE_MS = 280;
/** A left drag past this many px dismisses; a shorter one springs back. */
const DISMISS_DRAG_PX = 44;
/** Movement before a press counts as a drag (below it, a press is still a tap / poke). */
const DRAG_SLOP_PX = 8;
/** A drag to the RIGHT follows the finger at this fraction — the platform only leaves left. */
const RIGHTWARD_RESISTANCE = 0.25;
/** The bubble's first grow-in waits until the pawn has landed and settled, plus this. */
const FIRST_BUBBLE_AFTER_LAND_MS = 220;

/**
 * The pawn's drop onto the platform: the sky fall's physics (fallFromHeight) from the TOP
 * OF THE SCREEN (owner, 2026-11-08). The height is measured per arrival from the window,
 * so the pawn starts with its head just above the screen's top edge on any device: the
 * feet's resting screen y (the stage sits `24px − BASELINE_DROP` above the bottom; the
 * safe-area inset is ignored, which only starts it a few px higher), in world units, plus
 * the pawn's own height and a margin.
 */
function hintPawnDrop() {
    const restingBottomPx = 24 - BASELINE_DROP;
    const feetScreenY = window.innerHeight - restingBottomPx - (SCENE_BOX.height - SCENE_BOX.pawnY);
    return fallFromHeight(feetScreenY / PROJ.heightUnit + PAWN_TOP_Z + 0.5, "hint-pawn-drop");
}

const riseIn = keyframes({
    "0%": { transform: `translateY(${RISE_FROM_PX}px)`, opacity: 0 },
    "30%": { opacity: 1 },
    "100%": { transform: "translateY(0)", opacity: 1 },
});
const fadeIn = keyframes({ from: { opacity: 0 }, to: { opacity: 1 } });

interface BubbleValue {
    hint: PawnHint;
    line: string;
}

/** One arrival: when it started, and the pawn's entrance cue (read once by IsoPawn on mount). */
interface Arrival {
    id: number;
    startedAt: number;
    entrance: PawnEntranceCue;
}

/**
 * Resolves the `pawnDismissCue` soft introduction (docs/SOFT_INTRODUCTION.md) for ONE pawn
 * arrival. HintPawn itself stays mounted while its flp is parked under the tower, so calling
 * `useSoftIntro` there would decide the style once per tower visit and count one visit for
 * many sessions. Mounted with `key={arrival.id}` instead, each arrival is a fresh mount: one
 * visit (deduped to 30 min by the si store), and a style that holds for the whole session —
 * the cue never vanishes between two cards.
 */
function DismissCueSoftIntro({ children }: { children: (showDismissCue: boolean) => ReactNode }) {
    return <>{children(useSoftIntro("pawnDismissCue") === "intro")}</>;
}

export default function HintPawn({ world, hint, unseen, parked, contentRef, cardFrameRef }: HintPawnProps) {
    const spaceBelowCard = useSpaceBelowCard(contentRef, cardFrameRef, unseen);
    const dismissed = useHintPawnDismissed();
    const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
    const [arrival, setArrival] = useState<Arrival | null>(null);
    const [leaving, setLeaving] = useState(false);
    const arrivalIds = useRef(0);

    // Start the arrival on the first hint the learner can see. Never while dismissed.
    const hintDue = !!hint && !unseen && !parked && !dismissed;
    useEffect(() => {
        if (!hintDue || arrival) return;
        const now = performance.now();
        arrivalIds.current += 1;
        setArrival({
            id: arrivalIds.current,
            startedAt: now,
            // The pawn drops as the rise settles (reduced motion: no rise to wait for).
            entrance: { animation: hintPawnDrop(), startAt: now + (reduceMotion ? 0 : RISE_MS * 0.8) },
        });
    }, [hintDue, arrival, reduceMotion]);

    // Parking ends the session's visit: the pawn goes home, and the next dive arrives fresh.
    useEffect(() => {
        if (parked) {
            setArrival(null);
            setLeaving(false);
        }
    }, [parked]);

    // The dismissing throw: once it has played, the visit-wide flag takes over (unmounts).
    useEffect(() => {
        if (!leaving) return;
        const timer = setTimeout(dismissHintPawn, LEAVE_MS);
        return () => clearTimeout(timer);
    }, [leaving]);

    // ── The bubble ──
    // Each hint key takes its line ONCE, when first seen, so a re-render never re-rolls it.
    // (A ref survives StrictMode's double render, so the cursor is not advanced twice.)
    const lineForKey = useRef(new Map<string, string>());
    // Tap to dismiss closes THIS hint's bubble only (owner, 2026-11-08); the pawn stays and
    // the next card's hint grows a new one. Only a swipe sends the pawn away.
    const [closedKey, setClosedKey] = useState<string | null>(null);
    const showing = arrival && !leaving && !unseen && hint && hint.key !== closedKey ? hint : null;
    const desired = useMemo<PresenceItem<BubbleValue>[]>(() => {
        if (!showing) return [];
        let line = lineForKey.current.get(showing.key);
        if (line === undefined) {
            // One bag per kind; a conditional collection skips the lines this card fails.
            const eligible = showing.eligible;
            const index = takeHintLineIndex(showing.kind, showing.lines.length, eligible ? (i) => eligible[i] : undefined);
            line = showing.lines[index] ?? "";
            lineForKey.current.set(showing.key, line);
        }
        return [{ key: showing.key, value: { hint: showing, line } }];
    }, [showing]);

    // The first bubble of an arrival waits for the landing; later ones use the usual delay.
    const firstBubbleAt = arrival ? arrival.entrance.startAt + arrival.entrance.animation.durationMs + FIRST_BUBBLE_AFTER_LAND_MS : 0;
    const bubbles = useHintBubblePresence(desired, {
        enterDelayMs: Math.max(HINT_MOTION.enterDelayMs, firstBubbleAt - performance.now()),
        staggerMs: 0,
        exitMs: HINT_MOTION.popMs,
    });

    // The back stretch: one cue per bubble entrance (see the header's "Back stretch"). Keyed
    // by the bubble's key AND its grow-in time, so a bubble revived mid-pop (a new entrance
    // for the same key) stretches again; memoised on those primitives so a re-render with
    // the same newest bubble keeps the cue's identity and the scene memo below holds.
    const newest = bubbles.find((b) => b.phase === "in");
    const stretchKey = newest ? `${newest.key}@${newest.visibleAt}` : null;
    const stretchAt = newest?.visibleAt;
    const bubbleStretch = useMemo<PawnStretchCue | null>(
        () => (stretchKey !== null && stretchAt !== undefined ? { id: stretchKey, at: stretchAt } : null),
        [stretchKey, stretchAt]
    );

    // ── Idle animations ── (see the header). The minute counts from the landing; a new
    // line of dialogue (`stretchKey`) wakes a dozing or knitting pawn.
    const landedAt = arrival ? arrival.entrance.startAt + arrival.entrance.animation.durationMs : 0;
    const { idle, idleStretch, noteTap } = useHintPawnIdles({
        running: !!arrival && !leaving && !unseen && !parked && !dismissed,
        startAt: landedAt,
        wakeKey: stretchKey,
        resetKey: arrival?.id ?? null,
    });
    // The pawn has one stretch cue: whichever of the bubble's and the idle's is newer.
    const stretch = !idleStretch || (bubbleStretch && bubbleStretch.at >= idleStretch.at) ? bubbleStretch : idleStretch;

    // ── Tap reactions ── (see the header). Every tap restarts the idle minute and wakes it.
    const { ouches, say: sayOuch, hush: hushOuch } = usePawnOuch();
    const onPawnTap = useCallback(
        ({ airborne }: { airborne: boolean }): PawnTapReaction => {
            noteTap();
            if (airborne || Math.random() < PAWN_TAP_JUMP_SHARE) return "jump";
            sayOuch();
            return "flinch";
        },
        [noteTap, sayOuch]
    );
    // Hidden, leaving or gone home: no ouch stays up.
    const ouchAllowed = !!arrival && !leaving && !unseen && !parked;
    useEffect(() => {
        if (!ouchAllowed) hushOuch();
    }, [ouchAllowed, hushOuch]);

    // ── The swipe ──
    // Written straight to the DOM while dragging, so a drag never re-renders the scene.
    const dragRef = useRef<HTMLDivElement | null>(null);
    const press = useRef<{ id: number; x0: number; y0: number; dragging: boolean; dx: number } | null>(null);
    const setDrag = (dx: number, animate: boolean) => {
        const el = dragRef.current;
        if (!el) return;
        el.style.transition = animate ? "transform 220ms cubic-bezier(0.3, 1.4, 0.5, 1)" : "none";
        el.style.transform = dx === 0 ? "" : `translateX(${dx}px)`;
    };
    const dragJustEnded = useRef(false);
    const onClickCapture = (e: React.MouseEvent) => {
        if (!dragJustEnded.current) return;
        dragJustEnded.current = false;
        e.stopPropagation();
    };
    const onPointerDown = (e: React.PointerEvent) => {
        dragJustEnded.current = false;
        if (leaving) return;
        press.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dragging: false, dx: 0 };
    };
    const onPointerMove = (e: React.PointerEvent) => {
        const p = press.current;
        if (!p || p.id !== e.pointerId) return;
        const rawDx = e.clientX - p.x0;
        if (!p.dragging) {
            if (Math.abs(rawDx) < DRAG_SLOP_PX || Math.abs(rawDx) < Math.abs(e.clientY - p.y0)) return;
            p.dragging = true;
            // Capture on the element that was pressed (the stage itself is pointer-events: none).
            (e.target as Element).setPointerCapture?.(e.pointerId);
        }
        p.dx = rawDx > 0 ? rawDx * RIGHTWARD_RESISTANCE : rawDx;
        setDrag(p.dx, false);
    };
    const onPointerEnd = (e: React.PointerEvent) => {
        const p = press.current;
        if (!p || p.id !== e.pointerId) return;
        press.current = null;
        if (!p.dragging) return;
        // A drag is not a poke: swallow the click that follows the release (onClickCapture).
        dragJustEnded.current = true;
        if (p.dx <= -DISMISS_DRAG_PX) setLeaving(true);
        else setDrag(0, true);
    };

    // The scene never changes during a session but for the world; memoised so the bubble's
    // and the drag's renders leave the pawn's rAF-driven figure alone.
    const platform = TOWER_WORLDS[world];
    // NIGHT VEST (docs/HINT_PAWN.md § "Night vest"): after dark it wears a hi-viz safety
    // vest. "Dark" is the Deck Tower's own clock (useDayClock — the learner's real sunset,
    // and a feature tester's pinned phase), not the scene's colours: the session is always
    // drawn in day colours. It puts the vest on once the twilight is more night than day,
    // so it changes halfway through the hour-long blend, live if a session spans it.
    const { time: dayTime } = useDayClock(useTestingFeatures());
    const wearsVest = phaseShare(dayTime, "night") >= 0.5;
    // No light rim band round the top edge (owner, 2026-11-08): the rim takes the floor's
    // own tone, so the top reads as one flat face.
    const slabTone = useMemo(
        () => ({ material: platform.platform.material, rim: platform.platform.material.top }),
        [platform]
    );
    const scene = useMemo(
        () =>
            arrival ? (
                <IsoScene
                    proj={PROJ}
                    viewBox={SCENE_BOX.viewBox}
                    className="hint-pawn__scene"
                    style={{ width: SCENE_BOX.width, height: SCENE_BOX.height, display: "block", overflow: "visible" }}
                >
                    <IsoPlatform rect={PLATFORM} thickness={PLATFORM_THICKNESS} tone={slabTone}>
                        <IsoPawn
                            // A new arrival remounts the pawn so its entrance plays again.
                            key={arrival.id}
                            at={PAWN_AT}
                            surface={platform.floor}
                            entrance={arrival.entrance}
                            tappable
                            // No floor shadow: it clashed with the tiny slab (owner, 2026-11-08).
                            castsShadow={false}
                            stretch={stretch}
                            idle={idle}
                            onTap={onPawnTap}
                            vest={wearsVest}
                            facing={PAWN_FACING_DEG}
                        />
                    </IsoPlatform>
                </IsoScene>
            ) : null,
        [arrival, platform, slabTone, stretch, idle, onPawnTap, wearsVest]
    );

    if (!arrival || dismissed) return null;

    return (
        <>
            {/* The speech bubble, in the band below the card: from beside the stage to the right
                gutter, its tail pointing left at the pawn. Over the More Info pill (z-index 3) —
                a tap closes it and uncovers the pill. A sibling of the stage, not inside it, so
                it spans ContentArea's width; it stays put during a drag and pops on a throw. */}
            {/* One soft-intro decision per arrival (key) — see DismissCueSoftIntro. */}
            <DismissCueSoftIntro key={arrival.id}>
                {(showDismissCue) => bubbles.map((bubble) => (
                    <Box
                        key={bubble.key}
                        className="hint-pawn__bubble-slot"
                        sx={{
                            position: "absolute",
                            left: GUTTER + BUBBLE_LEFT_IN_STAGE,
                            right: GUTTER,
                            bottom: `calc(${BUBBLE_BOTTOM}px + ${SAFE_BOTTOM})`,
                            zIndex: 3,
                            pointerEvents: "none",
                            visibility: unseen ? "hidden" : undefined,
                        }}
                    >
                        <HintBubbleSurface
                            phase={bubble.phase}
                            delayMs={bubble.delayMs}
                            className="hint-pawn__bubble"
                            // Its own tail, angled up at the pawn's head (PawnBubbleTail).
                            tailSide="custom"
                            tailY="17px"
                            onSelect={() => setClosedKey(bubble.key)}
                            ariaLabel="Dismiss hint"
                            bodySx={{
                                width: "100%",
                                flexDirection: "row",
                                alignItems: "center",
                                gap: 0.75,
                                textAlign: "left",
                                // Capped to the space below the card, so it never overlaps it
                                // (owner, 2026-11-08). The CONTENT box clips what doesn't fit —
                                // not the body, whose overflow would cut its own tail off.
                                maxHeight: `max(44px, calc(${spaceBelowCard - BUBBLE_BOTTOM - BUBBLE_CARD_CLEARANCE}px - ${SAFE_BOTTOM}))`,
                            }}
                        >
                            <PawnBubbleTail head={PAWN_HEAD_FROM_BUBBLE} />
                            <Box
                                className="hint-pawn__bubble-content"
                                sx={{ flex: 1, minWidth: 0, alignSelf: "stretch", display: "flex", flexDirection: "column", overflow: "hidden" }}
                            >
                                <PawnHintBody hint={bubble.value.hint} line={bubble.value.line} showDismissCue={showDismissCue} />
                            </Box>
                        </HintBubbleSurface>
                    </Box>
                ))}
            </DismissCueSoftIntro>
            {/* The "ouch" bubbles (Tap reactions): their wrapper sits at the tail tip by the
                pawn's head, over the card and the hint bubble; the bubble rises up-right of it.
                Inert, so a tap on the card under it still reaches the card. */}
            {ouches.map((ouch) => (
                <Box
                    key={ouch.id}
                    className="hint-pawn__ouch-slot"
                    sx={{
                        position: "absolute",
                        left: GUTTER + OUCH_TIP.x,
                        bottom: `calc(24px + ${SAFE_BOTTOM} - ${BASELINE_DROP}px + ${SCENE_BOX.height - OUCH_TIP.y}px)`,
                        zIndex: 4,
                        pointerEvents: "none",
                        visibility: unseen ? "hidden" : undefined,
                    }}
                >
                    <PawnOuchBubble line={ouch.line} phase={ouch.phase} />
                </Box>
            ))}
            <Box
                className="hint-pawn"
                aria-hidden
                sx={{
                    position: "absolute",
                    left: GUTTER,
                    bottom: `calc(24px + ${SAFE_BOTTOM} - ${BASELINE_DROP}px)`,
                    width: SCENE_BOX.width,
                    height: SCENE_BOX.height,
                    zIndex: 2,
                    // See the header's "Hit area": only the platform and the pawn take touches.
                    pointerEvents: "none",
                    visibility: unseen ? "hidden" : undefined,
                    "& .iso-pawn__figure": { pointerEvents: "auto" },
                    animation: reduceMotion
                        ? `${fadeIn} 200ms ease-out both`
                        : `${riseIn} ${RISE_MS}ms cubic-bezier(0.2, 0.9, 0.3, 1.18) both`,
                }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerEnd}
                onPointerCancel={onPointerEnd}
                onClickCapture={onClickCapture}
            >
                <Box
                    ref={dragRef}
                    className={leaving ? "hint-pawn__drag hint-pawn__drag--leaving" : "hint-pawn__drag"}
                    sx={{
                        position: "relative",
                        width: "100%",
                        height: "100%",
                        touchAction: "none",
                        ...(leaving && {
                            // Off the screen's left edge, turned like a thrown tile.
                            transition: `transform ${LEAVE_MS}ms cubic-bezier(0.5, 0, 0.75, 0.4), opacity ${LEAVE_MS}ms ease-in !important`,
                            transform: `translateX(-${SCENE_BOX.width + GUTTER + 40}px) rotate(-12deg) !important`,
                            opacity: 0,
                        }),
                    }}
                >
                    {/* The platform's hit box: from the floor's back corner down, the slab's width.
                        Before the scene, so the pawn's own tap target (in the svg) stays on top. */}
                    <Box
                        className="hint-pawn__platform-hit"
                        sx={{ position: "absolute", left: 0, right: 0, top: SCENE_BOX.floorTop, bottom: 0, pointerEvents: "auto" }}
                    />
                    <Box className="hint-pawn__scene-layer" sx={{ position: "absolute", inset: 0 }}>
                        {scene}
                    </Box>
                </Box>
            </Box>
        </>
    );
}
